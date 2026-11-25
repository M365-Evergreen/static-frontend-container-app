import { Container, getContainer } from "@cloudflare/containers";
import { SessionStore } from "./session-store.ts";
import { SessionCoordinator } from "./session.ts";
import { D1ChatHistory } from "./chat-history.ts";
import { handleChatRequest } from "./chat-router.ts";
import { SessionError } from "./session-store.ts";
import { prepareContainer } from "./container-ready.ts";
import { downloadFile, listFiles, writeFile } from "./files.ts";
import {
  indexUploadedObjectAsync,
  reconcileBucket,
  drainPending,
  searchFiles,
} from "./fileIndex";

export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUDIENCE: string;
}

export interface AccessIdentity {
  sub: string;
  email?: string;
  claims: Record<string, unknown>;
}

export class AccessError extends Error {
  constructor(
    readonly code: string,
    readonly status = 401,
  ) {
    super(code);
  }
}

let accessJwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;
let accessJwksInflight: Promise<JsonWebKey[]> | null = null;
const ACCESS_JWKS_TTL_MS = 60 * 60 * 1000;
const ACCESS_CLOCK_SKEW_S = 60;

function accessTeamBase(env: AccessEnv): string {
  const raw = env.CF_ACCESS_TEAM_DOMAIN?.trim() ?? "";
  if (!raw) throw new AccessError("team_domain_unset", 500);
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `https://${host}`;
}

async function fetchAccessJwks(env: AccessEnv): Promise<JsonWebKey[]> {
  const response = await fetch(`${accessTeamBase(env)}/cdn-cgi/access/certs`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit);
  if (!response.ok) throw new AccessError("jwks_unavailable", 503);
  const body = await response.json() as { keys?: JsonWebKey[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  if (!keys.length) throw new AccessError("jwks_empty", 503);
  accessJwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function getAccessJwks(env: AccessEnv, forceRefresh = false): Promise<JsonWebKey[]> {
  const fresh = accessJwksCache && Date.now() - accessJwksCache.fetchedAt < ACCESS_JWKS_TTL_MS;
  if (fresh && !forceRefresh) return accessJwksCache!.keys;
  if (accessJwksInflight) return accessJwksInflight;
  accessJwksInflight = fetchAccessJwks(env).finally(() => { accessJwksInflight = null; });
  return accessJwksInflight;
}

function accessB64UrlBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const binary = atob((input + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function accessB64UrlJson<T>(input: string): T {
  return JSON.parse(new TextDecoder().decode(accessB64UrlBytes(input))) as T;
}

interface AccessClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  sub?: string;
  email?: string;
  [key: string]: unknown;
}

export async function verifyAccessJwt(token: string, env: AccessEnv): Promise<AccessIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessError("malformed_token");
  const [rawHeader, rawPayload, rawSignature] = parts;
  let header: { alg?: string; kid?: string };
  let claims: AccessClaims;
  try {
    header = accessB64UrlJson(rawHeader);
    claims = accessB64UrlJson(rawPayload);
  } catch {
    throw new AccessError("malformed_token");
  }
  if (header.alg !== "RS256") throw new AccessError("unsupported_alg");

  const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const signature = accessB64UrlBytes(rawSignature);
  const verifyWith = async (keys: JsonWebKey[]): Promise<boolean> => {
    const candidates = header.kid
      ? keys.filter((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid)
      : keys;
    for (const jwk of candidates) {
      try {
        const key = await crypto.subtle.importKey(
          "jwk",
          { ...jwk, alg: "RS256", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
        if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput)) return true;
      } catch {
        // Try the next key in case a rotation is in progress.
      }
    }
    return false;
  };

  let keys = await getAccessJwks(env);
  if (!(await verifyWith(keys))) {
    keys = await getAccessJwks(env, true);
    if (!(await verifyWith(keys))) throw new AccessError("bad_signature");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now - ACCESS_CLOCK_SKEW_S) {
    throw new AccessError("token_expired");
  }
  if (typeof claims.nbf === "number" && claims.nbf > now + ACCESS_CLOCK_SKEW_S) {
    throw new AccessError("token_not_yet_valid");
  }
  if (claims.iss !== accessTeamBase(env)) throw new AccessError("bad_issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.CF_ACCESS_AUDIENCE)) throw new AccessError("bad_audience");
  if (typeof claims.sub !== "string" || !claims.sub) throw new AccessError("missing_subject");
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    claims: claims as Record<string, unknown>,
  };
}

function accessDenied(code: string, status: number): Response {
  return Response.json({ error: "unauthorized", code }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function requireAccess(request: Request, env: AccessEnv): Promise<AccessIdentity | Response> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return accessDenied("missing_access_jwt", 401);
  try {
    return await verifyAccessJwt(token, env);
  } catch (error) {
    const code = error instanceof AccessError ? error.code : "verification_failed";
    const status = error instanceof AccessError ? error.status : 401;
    console.warn("accessAuth: rejected", code, request.url);
    return accessDenied(code, status);
  }
}

export interface ChatEnv {
  DB: D1Database;
}

export interface ConversationRow {
  id: string;
  owner_sub: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  owner_sub: string;
  run_id: string | null;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  seq: number;
  created_at: string;
}

export interface ExchangeInput {
  ownerSub: string;
  conversationId: string;
  runId: string;
  userContent: string;
  assistantContent: string;
  title?: string;
}

export interface PendingRevision {
  id: string;
  conversation_id: string;
  owner_sub: string;
  run_id: string | null;
  payload: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

const CHAT_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TEXT NOT NULL DEFAULT (${CHAT_NOW}),
  updated_at TEXT NOT NULL DEFAULT (${CHAT_NOW})
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_owner
  ON chat_conversations(owner_sub, updated_at DESC);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  owner_sub TEXT NOT NULL,
  run_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${CHAT_NOW})
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_run
  ON chat_messages(run_id, role) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_messages(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_chat_messages_owner
  ON chat_messages(owner_sub, created_at DESC);
CREATE TABLE IF NOT EXISTS chat_pending_revisions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  run_id TEXT,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (${CHAT_NOW})
);
CREATE INDEX IF NOT EXISTS idx_chat_pending_owner
  ON chat_pending_revisions(owner_sub, created_at);
`;

export async function appendExchange(env: ChatEnv, input: ExchangeInput): Promise<void> {
  const seqRow = await env.DB.prepare(
    `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM chat_messages
     WHERE conversation_id = ? AND owner_sub = ?`,
  ).bind(input.conversationId, input.ownerSub).first<{ max_seq: number }>();
  const baseSeq = seqRow?.max_seq ?? 0;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO chat_conversations (id, owner_sub, title)
       VALUES (?, ?, COALESCE(?, 'New chat'))
       ON CONFLICT(id) DO UPDATE SET
         updated_at = ${CHAT_NOW},
         title = CASE
           WHEN chat_conversations.title = 'New chat' AND ? IS NOT NULL THEN ?
           ELSE chat_conversations.title
         END
       WHERE chat_conversations.owner_sub = excluded.owner_sub`,
    ).bind(input.conversationId, input.ownerSub, input.title ?? null, input.title ?? null, input.title ?? null),
    env.DB.prepare(
      `INSERT OR IGNORE INTO chat_messages
       (id, conversation_id, owner_sub, run_id, role, content, seq)
       VALUES (?, ?, ?, ?, 'user', ?, ?)`,
    ).bind(crypto.randomUUID(), input.conversationId, input.ownerSub, input.runId, input.userContent, baseSeq + 1),
    env.DB.prepare(
      `INSERT OR IGNORE INTO chat_messages
       (id, conversation_id, owner_sub, run_id, role, content, seq)
       VALUES (?, ?, ?, ?, 'assistant', ?, ?)`,
    ).bind(crypto.randomUUID(), input.conversationId, input.ownerSub, input.runId, input.assistantContent, baseSeq + 2),
  ]);
}

export async function recordPendingRevision(
  env: ChatEnv,
  input: ExchangeInput & { error?: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO chat_pending_revisions
     (id, conversation_id, owner_sub, run_id, payload, last_error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.conversationId,
    input.ownerSub,
    input.runId,
    JSON.stringify({
      ownerSub: input.ownerSub,
      conversationId: input.conversationId,
      runId: input.runId,
      userContent: input.userContent,
      assistantContent: input.assistantContent,
      title: input.title ?? null,
    }),
    input.error ?? null,
  ).run();
}

export async function repairPendingRevisions(
  env: ChatEnv,
  ownerSub: string,
  opts: { conversationId?: string; limit?: number } = {},
): Promise<{ repaired: number; failed: number }> {
  const { conversationId, limit = 50 } = opts;
  const statement = conversationId
    ? env.DB.prepare(
      `SELECT * FROM chat_pending_revisions
       WHERE owner_sub = ? AND conversation_id = ?
       ORDER BY created_at LIMIT ?`,
    ).bind(ownerSub, conversationId, limit)
    : env.DB.prepare(
      `SELECT * FROM chat_pending_revisions
       WHERE owner_sub = ? ORDER BY created_at LIMIT ?`,
    ).bind(ownerSub, limit);
  const { results } = await statement.all<PendingRevision>();
  let repaired = 0;
  let failed = 0;
  for (const row of results ?? []) {
    try {
      await appendExchange(env, JSON.parse(row.payload) as ExchangeInput);
      await env.DB.prepare(`DELETE FROM chat_pending_revisions WHERE id = ?`).bind(row.id).run();
      repaired++;
    } catch (error) {
      failed++;
      await env.DB.prepare(
        `UPDATE chat_pending_revisions SET attempts = attempts + 1, last_error = ?
         WHERE id = ?`,
      ).bind(String(error), row.id).run();
    }
  }
  return { repaired, failed };
}

export async function listConversations(
  env: ChatEnv,
  ownerSub: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<ConversationRow[]> {
  const { limit = 50, offset = 0 } = opts;
  const { results } = await env.DB.prepare(
    `SELECT id, owner_sub, title, created_at, updated_at
     FROM chat_conversations
     WHERE owner_sub = ?
     ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).bind(ownerSub, limit, offset).all<ConversationRow>();
  return results ?? [];
}

export async function getTranscript(
  env: ChatEnv,
  ownerSub: string,
  conversationId: string,
): Promise<{ conversation: ConversationRow | null; messages: MessageRow[] }> {
  const conversation = await env.DB.prepare(
    `SELECT id, owner_sub, title, created_at, updated_at
     FROM chat_conversations WHERE id = ? AND owner_sub = ?`,
  ).bind(conversationId, ownerSub).first<ConversationRow>();
  if (!conversation) return { conversation: null, messages: [] };
  const { results } = await env.DB.prepare(
    `SELECT id, conversation_id, owner_sub, run_id, role, content, seq, created_at
     FROM chat_messages
     WHERE conversation_id = ? AND owner_sub = ?
     ORDER BY seq ASC`,
  ).bind(conversationId, ownerSub).all<MessageRow>();
  return { conversation, messages: results ?? [] };
}

export async function deleteConversation(
  env: ChatEnv,
  ownerSub: string,
  conversationId: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `DELETE FROM chat_conversations WHERE id = ? AND owner_sub = ?`,
  ).bind(conversationId, ownerSub).run();
  return (result.meta?.changes ?? 0) > 0;
}

export class AgentContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";

  envVars = {
    LLM_API_KEY: this.env.LLM_API_KEY ?? "",
    LLM_PROVIDER: this.env.LLM_PROVIDER,
    LLM_MODEL: this.env.LLM_MODEL,
    KNOWLEDGE_MCP_URL: this.env.KNOWLEDGE_MCP_URL,
  };

  private readonly session: SessionCoordinator;

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.session = new SessionCoordinator(
      new SessionStore(ctx.storage),
      (request) => this.runInContainer(request),
      (task) => ctx.waitUntil(task),
      120000,
      new D1ChatHistory(env.DB),
    );
  }

  override fetch(request: Request): Promise<Response> {
    return this.session.fetch(request);
  }

  private async runInContainer(request: Request): Promise<Response> {
    const container = this.ctx.container;
    if (!container) {
      throw new SessionError("backend_failed", "No container is available.");
    }
    await prepareContainer({
      start: () => this.start(undefined, { signal: request.signal }),
      health: () => container.getTcpPort(this.defaultPort).fetch("http://container/health", {
        signal: request.signal,
      }),
      ready: () => this.startAndWaitForPorts(this.defaultPort, {
        abort: request.signal,
        instanceGetTimeoutMS: 300,
        portReadyTimeoutMS: 300,
      }),
    }, request.signal);
    this.renewActivityTimeout();
    return container.getTcpPort(this.defaultPort).fetch(request);
  }

  override onStart() {
    console.log("Stateful AgentContainer started");
  }

  override onStop() {
    console.log("Stateful AgentContainer went to sleep");
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const auth = await requireAccess(request, env);
    if (auth instanceof Response) return auth;
    const ownerSub = auth.sub;
    const url = new URL(request.url);
    if (request.method === "PUT" && url.pathname.startsWith("/upload/")) {
      const key = url.pathname.slice("/upload/".length);
      await env.R2.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get("content-type") ?? undefined },
      });
      indexUploadedObjectAsync(env, key, ctx);        // strategy 1
      return new Response("uploaded", { status: 201 });
    }
    if (url.pathname === "/api/files/search") {
      return Response.json(await searchFiles(env, url.searchParams.get("q") ?? ""));
    }
    if (url.pathname === "/api/files/index") {
      return Response.json(await reconcileBucket(env));
    }
    if (url.pathname === "/api/files/drain") {
      return Response.json(await drainPending(env, { limit: 200 }));
    }

    if (url.pathname === "/api/files") {
      return listFiles(request, env.R2);
    }
    if (url.pathname === "/api/files/download") {
      return downloadFile(request, env.R2);
    }
    if (url.pathname === "/api/files/upload") {
      return writeFile(request, env.R2);
    }
    if (url.pathname === "/api/files/folder") {
      return writeFile(request, env.R2, true);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleChatRequest(request, env, (sessionId, forwarded) =>
        getContainer(env.AGENT_CONTAINER, sessionId).fetch(forwarded));
    }

    const identityHeaders = new Headers(request.headers);
    identityHeaders.set("x-chat-owner", `access:${ownerSub}`);
    identityHeaders.delete("cf-access-jwt-assertion");
    identityHeaders.delete("authorization");
    identityHeaders.delete("cf-access-authenticated-user-email");
    return env.ASSETS.fetch(new Request(request, { headers: identityHeaders }));
  },
} satisfies ExportedHandler<Env>;
