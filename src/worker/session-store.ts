export interface Message {
  sequence: number;
  role: "user" | "assistant";
  content: string;
  request_id: string;
}

export interface ChatInput {
  prompt: string;
  max_turns: number;
}

export interface Completion {
  status: "done";
  request_id: string;
  final_output: string;
  history_length: number;
}

export interface SessionDatabase {
  sql: {
    exec(query: string, ...bindings: (string | number | null)[]): Iterable<Record<string, unknown>>;
  };
  transactionSync<T>(callback: () => T): T;
}

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
  }
}

export class SessionStore {
  constructor(private readonly database: SessionDatabase) {
    database.sql.exec(`
      CREATE TABLE IF NOT EXISTS chat_session (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        session_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_requests (
        request_id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        max_turns INTEGER NOT NULL,
        token TEXT NOT NULL,
        lease_until INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed')),
        final_output TEXT,
        history_length INTEGER
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        sequence INTEGER PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        request_id TEXT NOT NULL
      );
    `);
  }

  identify(sessionId: string) {
    const [row] = this.database.sql.exec("SELECT session_id FROM chat_session");
    if (row && row.session_id !== sessionId) {
      throw new SessionError("session_mismatch", "Session does not match this object.", 403);
    }
    if (!row) {
      this.database.sql.exec("INSERT INTO chat_session VALUES (1, ?)", sessionId);
    }
  }

  history(): Message[] {
    return [...this.database.sql.exec("SELECT * FROM chat_messages ORDER BY sequence")].map((row) => {
      if (
        typeof row.sequence !== "number" ||
        (row.role !== "user" && row.role !== "assistant") ||
        typeof row.content !== "string" ||
        typeof row.request_id !== "string"
      ) {
        throw new SessionError("invalid_storage", "Stored history is invalid.", 500);
      }
      return {
        sequence: row.sequence,
        role: row.role,
        content: row.content,
        request_id: row.request_id,
      };
    });
  }

  private expire(now: number) {
    this.database.sql.exec(
      "DELETE FROM chat_requests WHERE status = 'running' AND lease_until <= ?",
      now,
    );
  }

  active(now: number) {
    this.expire(now);
    const [row] = this.database.sql.exec(
      "SELECT request_id FROM chat_requests WHERE status = 'running'",
    );
    return row;
  }

  claim(requestId: string, input: ChatInput, token: string, deadline: number, now: number) {
    return this.database.transactionSync(() => {
      this.expire(now);
      const [row] = this.database.sql.exec(
        "SELECT * FROM chat_requests WHERE request_id = ?",
        requestId,
      );
      if (row && (row.prompt !== input.prompt || row.max_turns !== input.max_turns)) {
        throw new SessionError(
          "request_id_conflict",
          "Request ID was already used with different input.",
          409,
        );
      }
      if (row?.status === "completed") {
        if (typeof row.final_output !== "string" || typeof row.history_length !== "number") {
          throw new SessionError("invalid_storage", "Stored completion is invalid.", 500);
        }
        return {
          status: "done" as const,
          request_id: requestId,
          final_output: row.final_output,
          history_length: row.history_length,
        };
      }
      if (this.active(now)) {
        throw new SessionError("session_busy", "A run is already active for this session.", 409);
      }
      this.database.sql.exec(
        "INSERT INTO chat_requests VALUES (?, ?, ?, ?, ?, 'running', NULL, NULL)",
        requestId,
        input.prompt,
        input.max_turns,
        token,
        deadline,
      );
      return undefined;
    });
  }

  complete(requestId: string, token: string, result: Completion, now: number) {
    this.database.transactionSync(() => {
      const [row] = this.database.sql.exec(
        "SELECT * FROM chat_requests WHERE request_id = ? AND token = ? AND status = 'running' AND lease_until > ?",
        requestId,
        token,
        now,
      );
      if (!row || typeof row.prompt !== "string") {
        throw new SessionError("run_expired", "The run is no longer active.", 409);
      }
      const length = this.history().length;
      if (result.history_length !== length + 2) {
        throw new SessionError("invalid_completion", "Backend returned inconsistent history.");
      }
      this.database.sql.exec(
        "INSERT INTO chat_messages VALUES (?, 'user', ?, ?), (?, 'assistant', ?, ?)",
        length + 1,
        row.prompt,
        requestId,
        length + 2,
        result.final_output,
        requestId,
      );
      this.database.sql.exec(
        "UPDATE chat_requests SET status = 'completed', final_output = ?, history_length = ? WHERE request_id = ? AND token = ?",
        result.final_output,
        result.history_length,
        requestId,
        token,
      );
    });
  }

  release(requestId: string, token: string) {
    this.database.sql.exec(
      "DELETE FROM chat_requests WHERE request_id = ? AND token = ? AND status = 'running'",
      requestId,
      token,
    );
  }

  clear(now: number) {
    this.database.transactionSync(() => {
      if (this.active(now)) {
        throw new SessionError("session_busy", "Cannot delete history during an active run.", 409);
      }
      // Leave the Container's lifecycle storage and schedules intact.
      this.database.sql.exec("DELETE FROM chat_messages; DELETE FROM chat_requests;");
    });
  }
}
