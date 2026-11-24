import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { D1ChatHistory, type HistorySnapshot } from "../../src/worker/chat-history.ts";
import { handleChatRequest } from "../../src/worker/chat-router.ts";
import { authenticateEntra } from "../../src/worker/entra-auth.ts";
import { SessionError } from "../../src/worker/session-store.ts";
import { SqliteD1 } from "./sqlite-d1.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER = `${TENANT}:${USER}`;
const OTHER_OWNER = `${TENANT}:${OTHER_USER}`;
const config = {
  ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT,
  ENTRA_API_AUDIENCE: CLIENT, ENTRA_API_SCOPE: `api://${CLIENT}/Chat.Access`,
};
const pair = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test-key" }] });

async function token(overrides: JWTPayload = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT,
    tid: TENANT, oid: USER, ver: "2.0", azp: CLIENT, scp: "Chat.Access",
    iat: now, nbf: now - 60, exp: now + 3600, ...overrides,
  }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(pair.privateKey);
}

function request(path: string, accessToken?: string) {
  return new Request(`https://app.test${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

function snapshot(overrides: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return {
    session_id: SESSION, owner_id: OWNER, revision: 1, created_at: 100, updated_at: 200,
    messages: [
      { sequence: 1, role: "user", content: "A private question", request_id: REQUEST },
      { sequence: 2, role: "assistant", content: "A private reply", request_id: REQUEST },
    ],
    ...overrides,
  };
}

test("Entra validates signed delegated API tokens and derives identity from tenant and object ID", async () => {
  assert.equal(await authenticateEntra(request("/api/history", await token()), config, keys), OWNER);
  await assert.rejects(authenticateEntra(request("/api/history"), config, keys),
    (error: unknown) => error instanceof SessionError && error.status === 401);
});

for (const [name, claims] of [
  ["wrong API audience", { aud: "00000003-0000-0000-c000-000000000000" }],
  ["wrong issuer", { iss: `https://login.microsoftonline.com/${OTHER_USER}/v2.0` }],
  ["expired token", { exp: Math.floor(Date.now() / 1000) - 60 }],
  ["future token", { nbf: Math.floor(Date.now() / 1000) + 3600 }],
  ["missing expiry", { exp: undefined }],
  ["wrong tenant", { tid: OTHER_USER }],
  ["missing identity", { oid: undefined }],
  ["ID token without API scope", { scp: undefined }],
  ["wrong delegated scope", { scp: "User.Read" }],
  ["wrong authorised client", { azp: OTHER_USER }],
  ["v1 token", { ver: "1.0" }],
] satisfies [string, JWTPayload][]) {
  test(`Entra rejects ${name}`, async () => {
    await assert.rejects(authenticateEntra(request("/api/history", await token(claims)), config, keys),
      (error: unknown) => error instanceof SessionError && [401, 403].includes(error.status));
  });
}

test("forged signatures are rejected and missing configuration fails closed", async () => {
  const untrusted = await generateKeyPair("RS256");
  const forged = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(untrusted.privateKey);
  await assert.rejects(authenticateEntra(request("/api/history", forged), config, keys), SessionError);
  const env = { ...config, ENTRA_TENANT_ID: "", DB: new SqliteD1() };
  for (const path of ["/api/history", "/api/conversations", "/api/auth/config"]) {
    const result = await handleChatRequest(request(path), env, async () => { throw new Error("Must not forward"); });
    assert.equal(result.status, 503);
    assert.match(await result.text(), /authentication_not_configured/);
  }
});

test("Worker replaces client-supplied owner headers and never sends Entra tokens to the container", async () => {
  const incoming = request("/api/history", await token());
  incoming.headers.set("x-session-id", SESSION.toUpperCase());
  incoming.headers.set("x-chat-owner", OTHER_OWNER);
  let calls = 0;
  const result = await handleChatRequest(incoming, { ...config, DB: new SqliteD1() }, async (id, forwarded) => {
    calls++;
    assert.equal(id, SESSION);
    assert.equal(forwarded.headers.get("x-chat-owner"), OWNER);
    assert.equal(forwarded.headers.get("authorization"), null);
    return Response.json({ messages: [] });
  }, (req, env) => authenticateEntra(req, env, keys));
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
});

test("D1 stores ordered messages atomically, supports replay and rejects stale or cross-owner snapshots", async () => {
  const db = new SqliteD1();
  const history = new D1ChatHistory(db);
  const original = snapshot();
  await history.write(original);
  await history.write(original);
  assert.deepEqual(db.db.prepare("SELECT role, content FROM chat_messages ORDER BY sequence").all().map((row) => ({ ...row })), [
    { role: "user", content: "A private question" }, { role: "assistant", content: "A private reply" },
  ]);
  await history.write(snapshot({ revision: 2, updated_at: 300, messages: [] }));
  await history.write(original);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM chat_messages").get()?.count, 0);
  await assert.rejects(history.write(snapshot({ owner_id: OTHER_OWNER, revision: 3 })), SessionError);
  const catalogue = await history.list(OWNER, new URL("https://app.test/api/conversations"));
  assert.deepEqual(catalogue.conversations, []);
});

test("a failed D1 batch does not leave a partial conversation or messages", async () => {
  const db = new SqliteD1();
  db.db.exec(`CREATE TRIGGER reject_assistant BEFORE INSERT ON chat_messages
    WHEN new.role = 'assistant' BEGIN SELECT RAISE(ABORT, 'Injected failure'); END;`);
  await assert.rejects(new D1ChatHistory(db).write(snapshot()), SessionError);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM chat_conversations").get()?.count, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM chat_messages").get()?.count, 0);
});

test("authenticated catalogue is owner-scoped and paginated without a session header", async () => {
  const DB = new SqliteD1();
  const history = new D1ChatHistory(DB);
  await history.write(snapshot());
  await history.write(snapshot({ session_id: OTHER_SESSION, updated_at: 300 }));
  await history.write(snapshot({ session_id: REQUEST, owner_id: OTHER_OWNER, updated_at: 400 }));
  const authenticate = (req: Request) => authenticateEntra(req, config, keys);
  const first = await handleChatRequest(request("/api/conversations?limit=1", await token()), { ...config, DB },
    async () => { throw new Error("Listing must not start a container"); }, authenticate);
  assert.equal(first.status, 200);
  const page = await first.json() as { conversations: { session_id: string }[]; cursor: string };
  assert.deepEqual(page.conversations.map((item) => item.session_id), [OTHER_SESSION]);
  const second = await history.list(OWNER, new URL(`https://app.test/api/conversations?limit=1&cursor=${encodeURIComponent(page.cursor)}`));
  assert.deepEqual(second.conversations.map((item) => item.session_id), [SESSION]);
  assert.equal(second.cursor, null);
  for (const query of ["limit=0", "limit=51", "cursor=invalid"]) {
    await assert.rejects(history.list(OWNER, new URL(`https://app.test/api/conversations?${query}`)), SessionError);
  }
  const denied = await handleChatRequest(request("/api/conversations"), { ...config, DB },
    async () => { throw new Error("Must not forward"); }, authenticate);
  assert.equal(denied.status, 401);
});

test("chat migration can be applied alongside the existing commands and files schema", () => {
  const db = new SqliteD1();
  db.db.exec(readFileSync("schema.sql", "utf8"));
  db.db.exec(readFileSync("migrations/0001_chat_history.sql", "utf8"));
  for (const table of ["commands", "files", "chat_conversations", "chat_messages"]) {
    assert.equal(db.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
  }
});
