import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import {
  authenticateCloudflareAccess,
} from "../../src/worker/cloudflare-access-auth.ts";
import { D1ChatHistory, type HistorySnapshot } from "../../src/worker/chat-history.ts";
import { handleChatRequest } from "../../src/worker/chat-router.ts";
import { SessionError } from "../../src/worker/session-store.ts";
import { SqliteD1 } from "./sqlite-d1.ts";

const TEAM = "example.cloudflareaccess.com";
const AUD = "test-access-audience";
const SUBJECT = "access-user-1";
const OWNER = `access:${SUBJECT}`;
const OTHER_OWNER = "access:access-user-2";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const config = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUDIENCE: AUD };
const pair = await generateKeyPair("RS256");
const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test-key" }] });

async function token(overrides: JWTPayload = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: `https://${TEAM}`, aud: AUD, sub: SUBJECT,
    email: "selected@example.com", iat: now, exp: now + 3600,
    ...overrides,
  }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(pair.privateKey);
}

function request(path: string, assertion?: string) {
  return new Request(`https://app.test${path}`, {
    headers: assertion ? { "cf-access-jwt-assertion": assertion } : {},
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

test("Cloudflare Access validates signed assertions and derives an owner from sub", async () => {
  const identity = await authenticateCloudflareAccess(request("/api/history", await token()), config, keys);
  assert.deepEqual(identity, { ownerId: OWNER, name: "selected@example.com" });
  await assert.rejects(authenticateCloudflareAccess(request("/api/history"), config, keys),
    (error: unknown) => error instanceof SessionError && error.status === 401);
});

for (const [name, claims] of [
  ["wrong audience", { aud: "wrong-audience" }],
  ["wrong issuer", { iss: "https://wrong.cloudflareaccess.com" }],
  ["expired token", { exp: Math.floor(Date.now() / 1000) - 60 }],
  ["missing expiry", { exp: undefined }],
  ["missing subject", { sub: undefined }],
] satisfies [string, JWTPayload][]) {
  test(`Cloudflare Access rejects ${name}`, async () => {
    await assert.rejects(authenticateCloudflareAccess(request("/api/history", await token(claims)), config, keys),
      (error: unknown) => error instanceof SessionError && [401, 403].includes(error.status));
  });
}

test("forged signatures are rejected and missing configuration fails closed", async () => {
  const untrusted = await generateKeyPair("RS256");
  const forged = await new SignJWT({ sub: SUBJECT }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(untrusted.privateKey);
  await assert.rejects(authenticateCloudflareAccess(request("/api/history", forged), config, keys), SessionError);
  const env = { ...config, CF_ACCESS_AUDIENCE: "", DB: new SqliteD1() };
  for (const path of ["/api/auth/status", "/api/history", "/api/conversations"]) {
    const result = await handleChatRequest(request(path), env, async () => { throw new Error("Must not forward"); });
    assert.equal(result.status, 503);
    assert.match(await result.text(), /authentication_not_configured/);
  }
});

test("Worker replaces client owner headers and strips Access identity headers", async () => {
  const incoming = request("/api/chat", await token());
  incoming.headers.set("x-request-id", REQUEST);
  incoming.headers.set("x-session-id", SESSION.toUpperCase());
  incoming.headers.set("x-chat-owner", OTHER_OWNER);
  incoming.headers.set("cf-access-authenticated-user-email", "attacker@example.com");
  let calls = 0;
  const result = await handleChatRequest(incoming, { ...config, DB: new SqliteD1() }, async (id, forwarded) => {
    calls++;
    assert.equal(id, SESSION);
    assert.equal(forwarded.headers.get("x-chat-owner"), OWNER);
    assert.equal(forwarded.headers.get("cf-access-jwt-assertion"), null);
    assert.equal(forwarded.headers.get("cf-access-authenticated-user-email"), null);
    return Response.json({ messages: [] });
  }, (req, env) => authenticateCloudflareAccess(req, env, keys));
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
});

test("D1 stores ordered messages, serves history and rejects stale or cross-owner snapshots", async () => {
  const db = new SqliteD1();
  const history = new D1ChatHistory(db);
  await history.write(snapshot());
  await history.write(snapshot());
  assert.deepEqual((await history.load(OWNER, SESSION)).messages.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "A private question" },
    { role: "assistant", content: "A private reply" },
  ]);
  assert.deepEqual((await history.load(OTHER_OWNER, SESSION)).messages, []);
  await history.write(snapshot({ revision: 2, updated_at: 300, messages: [] }));
  assert.equal((await history.load(OWNER, SESSION)).messages.length, 0);
  await assert.rejects(history.write(snapshot({ owner_id: OTHER_OWNER, revision: 3 })), SessionError);
});

test("authenticated catalogue is owner-scoped and paginated", async () => {
  const DB = new SqliteD1();
  const history = new D1ChatHistory(DB);
  await history.write(snapshot());
  await history.write(snapshot({ session_id: OTHER_SESSION, updated_at: 300 }));
  await history.write(snapshot({ session_id: REQUEST, owner_id: OTHER_OWNER, updated_at: 400 }));
  const authenticate = (req: Request) => authenticateCloudflareAccess(req, config, keys);
  const first = await handleChatRequest(request("/api/conversations?limit=1", await token()), { ...config, DB },
    async () => { throw new Error("Listing must not start a container"); }, authenticate);
  assert.equal(first.status, 200);
  const page = await first.json() as { conversations: { session_id: string }[]; cursor: string };
  assert.deepEqual(page.conversations.map((item) => item.session_id), [OTHER_SESSION]);
  const second = await history.list(OWNER, new URL(`https://app.test/api/conversations?limit=1&cursor=${encodeURIComponent(page.cursor)}`));
  assert.deepEqual(second.conversations.map((item) => item.session_id), [SESSION]);
  assert.equal(second.cursor, null);
});

test("chat migration can be applied alongside the existing commands and files schema", () => {
  const db = new SqliteD1();
  db.db.exec(readFileSync("schema.sql", "utf8"));
  db.db.exec(readFileSync("migrations/0001_chat_history.sql", "utf8"));
  for (const table of ["commands", "files", "chat_conversations", "chat_messages"]) {
    assert.equal(db.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 0);
  }
});
