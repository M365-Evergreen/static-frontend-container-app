import { SessionError, type Message } from "./session-store.ts";

export interface HistorySnapshot {
  session_id: string;
  owner_id: string;
  revision: number;
  created_at: number;
  updated_at: number;
  messages: Message[];
}

export interface HistorySink {
  write(snapshot: HistorySnapshot): Promise<void>;
}

interface Conversation {
  session_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export class D1ChatHistory implements HistorySink {
  constructor(private readonly db: Pick<D1Database, "prepare" | "batch">) {}

  async write(snapshot: HistorySnapshot): Promise<void> {
    const { session_id: sessionId, owner_id: ownerId, revision, messages } = snapshot;
    const title = Array.from(messages[0]?.content.trim().replace(/\s+/g, " ") ?? "").slice(0, 100).join("");
    const guard = "EXISTS (SELECT 1 FROM chat_conversations WHERE session_id = ? AND owner_id = ? AND revision = ?)";
    try {
      // One D1 transaction, guarded by the DO revision, makes retries and stale writes safe.
      const results = await this.db.batch<{ owner_id: string; revision: number }>([
        this.db.prepare(`
          INSERT INTO chat_conversations (session_id, owner_id, title, revision, created_at, updated_at, message_count)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            title = excluded.title, revision = excluded.revision,
            updated_at = excluded.updated_at, message_count = excluded.message_count
          WHERE chat_conversations.owner_id = excluded.owner_id
            AND chat_conversations.revision <= excluded.revision
        `).bind(sessionId, ownerId, title, revision, snapshot.created_at, snapshot.updated_at, messages.length),
        this.db.prepare(`DELETE FROM chat_messages WHERE session_id = ? AND ${guard}`)
          .bind(sessionId, sessionId, ownerId, revision),
        ...messages.map((message) => this.db.prepare(`
          INSERT INTO chat_messages (session_id, sequence, role, content, request_id)
          SELECT ?, ?, ?, ?, ? WHERE ${guard}
        `).bind(sessionId, message.sequence, message.role, message.content, message.request_id, sessionId, ownerId, revision)),
        this.db.prepare("SELECT owner_id, revision FROM chat_conversations WHERE session_id = ?").bind(sessionId),
      ]);
      const stored = results.at(-1)?.results[0];
      if (results.some((result) => !result.success) || stored?.owner_id !== ownerId || stored.revision < revision) {
        throw new Error("Chat projection was not confirmed.");
      }
    } catch {
      console.error(JSON.stringify({ event: "chat_history_sync_failed", session_id: sessionId, revision }));
      throw new SessionError(
        "history_sync_failed",
        "Conversation changes are saved in session storage, but D1 history could not be updated. Reload history to retry.",
        503,
      );
    }
  }

  async list(ownerId: string, url: URL) {
    const limitText = url.searchParams.get("limit") ?? "20";
    if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 50) {
      throw new SessionError("invalid_pagination", "limit must be an integer from 1 to 50.", 400);
    }
    const limit = Number(limitText);
    let cursor: { updated_at: number; session_id: string } | undefined;
    const encoded = url.searchParams.get("cursor");
    if (encoded !== null) {
      try {
        const value: unknown = JSON.parse(atob(encoded));
        if (
          typeof value !== "object" || value === null ||
          !("updated_at" in value) || typeof value.updated_at !== "number" ||
          !Number.isSafeInteger(value.updated_at) || value.updated_at < 0 ||
          !("session_id" in value) || typeof value.session_id !== "string" ||
          !/^[0-9a-f-]{36}$/.test(value.session_id)
        ) throw new Error("Invalid cursor");
        cursor = { updated_at: value.updated_at, session_id: value.session_id };
      } catch {
        throw new SessionError("invalid_pagination", "The conversation cursor is invalid.", 400);
      }
    }
    try {
      const query = this.db.prepare(`
        SELECT session_id, title, created_at, updated_at, message_count
        FROM chat_conversations WHERE owner_id = ? AND message_count > 0
        ${cursor ? "AND (updated_at < ? OR (updated_at = ? AND session_id < ?))" : ""}
        ORDER BY updated_at DESC, session_id DESC LIMIT ?
      `);
      const result = await (cursor
        ? query.bind(ownerId, cursor.updated_at, cursor.updated_at, cursor.session_id, limit + 1)
        : query.bind(ownerId, limit + 1)).all<Conversation>();
      if (!result.success) throw new Error("Chat catalogue query failed.");
      const conversations = result.results.slice(0, limit);
      const last = conversations.at(-1);
      return {
        conversations,
        cursor: result.results.length > limit && last
          ? btoa(JSON.stringify({ updated_at: last.updated_at, session_id: last.session_id }))
          : null,
      };
    } catch {
      console.error(JSON.stringify({ event: "chat_history_list_failed" }));
      throw new SessionError("history_unavailable", "Conversation history is temporarily unavailable.", 503);
    }
  }
}
