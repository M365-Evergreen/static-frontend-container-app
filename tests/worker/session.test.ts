import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  SessionError,
  SessionStore,
  type ChatInput,
  type Message,
  type SessionDatabase,
} from "../../src/worker/session-store.ts";
import { SessionCoordinator } from "../../src/worker/session.ts";
import { frame } from "../../src/worker/session-stream.ts";

const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222";
const REQUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEXT_REQUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
type RunInput = ChatInput & {
  request_id: string;
  history: Pick<Message, "role" | "content">[];
};

function sqlite() {
  const db = new DatabaseSync(":memory:");
  const database: SessionDatabase = {
    sql: {
      exec(query, ...bindings) {
        if (query.includes(";")) {
          db.exec(query);
          return [];
        }
        return db.prepare(query).all(...bindings);
      },
    },
    transactionSync(callback) {
      db.exec("BEGIN");
      try {
        const value = callback();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { database, db };
}

function request(
  method = "POST",
  path = "/api/chat",
  requestId = REQUEST,
  body: unknown = { prompt: "Hello" },
  sessionId = SESSION,
) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
      "x-request-id": requestId,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

function upstream(events: unknown[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const text = events.map((event) => new TextDecoder().decode(frame(event))).join("").replaceAll("\n", "\r\n");
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

function progress(turn = 1) {
  const names = ["planner_agent", "research_agent", "synthesizer_agent"];
  return { status: "running", turn, agent: names[turn - 1], output: "Progress \u{1f680}" };
}

function pipelineProgress() {
  return [progress(1), progress(2), progress(3)];
}

function completion(body: RunInput) {
  return {
    status: "done",
    request_id: body.request_id,
    final_output: "Completed",
    history_length: body.history.length + 2,
  };
}

function harness(
  backend?: (request: Request) => Promise<Response>,
  timeout = 1000,
  database = sqlite().database,
) {
  const tasks: Promise<void>[] = [];
  const payloads: RunInput[] = [];
  const store = new SessionStore(database);
  const run = backend ?? (async (request: Request) => {
    const body = await request.json() as RunInput;
    payloads.push(body);
    return upstream([...pipelineProgress(), completion(body)]);
  });
  const coordinator = new SessionCoordinator(store, run, (task) => tasks.push(task), timeout);
  return { coordinator, store, tasks, payloads, database };
}

async function events(response: Response): Promise<Record<string, unknown>[]> {
  return (await response.text()).split("\n").filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

test("authoritative history survives coordinator recreation and retries do not duplicate turns", async () => {
  const first = harness();
  assert.equal((await events(await first.coordinator.fetch(request()))).at(-1)?.status, "done");
  assert.deepEqual(first.payloads[0].history, []);
  const reloaded = harness(undefined, 1000, first.database);
  const replay = await events(await reloaded.coordinator.fetch(request()));
  assert.equal(replay.length, 1);
  assert.equal(replay[0].status, "done");
  assert.equal(reloaded.payloads.length, 0);
  const prior = first.store.history().map(({ role, content }) => ({ role, content }));
  await events(await reloaded.coordinator.fetch(request("POST", "/api/chat", NEXT_REQUEST)));
  assert.deepEqual(reloaded.payloads[0].history, prior);
  const history = await reloaded.coordinator.fetch(request("GET", "/api/history"));
  const transcript = await history.json() as { messages: Message[] };
  assert.equal(transcript.messages.length, 4);
  for (const body of [{ prompt: "Changed" }, { prompt: "Hello", max_turns: 3 }]) {
    assert.equal((await reloaded.coordinator.fetch(request("POST", "/api/chat", REQUEST, body))).status, 409);
  }
});

test("validation rejects missing, malformed and conflicting IDs and client-supplied history", async () => {
  const { coordinator, payloads } = harness();
  const missing = request();
  missing.headers.delete("x-session-id");
  assert.equal((await coordinator.fetch(missing)).status, 400);
  assert.equal((await coordinator.fetch(request("GET", "/api/history", REQUEST, {}, "default-session"))).status, 400);
  const noRequest = request();
  noRequest.headers.delete("x-request-id");
  assert.equal((await coordinator.fetch(noRequest)).status, 400);
  for (const body of [
    { prompt: " " }, { prompt: "Hello", history: [] }, { prompt: "Hello", max_turns: 0 },
    { prompt: "Hello", max_turns: 1.5 }, { prompt: "Hello", max_turns: "3" },
    { prompt: "Hello", max_turns: null },
    { prompt: "Hello", max_turns: 1 }, { prompt: "Hello", max_turns: 2 },
  ]) {
    assert.equal((await coordinator.fetch(request("POST", "/api/chat", REQUEST, body))).status, 400);
  }
  const upper = request();
  upper.headers.set("x-request-id", REQUEST.toUpperCase());
  await events(await coordinator.fetch(upper));
  assert.equal(payloads[0].request_id, REQUEST);
  assert.equal((await coordinator.fetch(request("GET", "/api/history", REQUEST, {}, OTHER_SESSION))).status, 403);
});

test("history and deletion are isolated and deletion removes deduplication records", async () => {
  const a = harness();
  const b = harness();
  await events(await a.coordinator.fetch(request()));
  await events(await b.coordinator.fetch(request("POST", "/api/chat", REQUEST, { prompt: "Other" }, OTHER_SESSION)));
  assert.equal((await a.coordinator.fetch(request("DELETE", "/api/history"))).status, 204);
  assert.deepEqual(a.store.history(), []);
  assert.equal(b.store.history().length, 2);
  await events(await a.coordinator.fetch(request()));
  assert.equal(a.payloads.length, 2);
  assert.deepEqual(a.payloads[1].history, []);
});

test("overlapping submissions and deletion are rejected; explicit cancellation releases the run", async () => {
  let stalled = true;
  let cancelled = false;
  const h = harness(async (req) => {
    const body = await req.json() as RunInput;
    if (!stalled) return upstream([...pipelineProgress(), completion(body)]);
    req.signal.addEventListener("abort", () => { cancelled = true; });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(frame(progress())); } }),
      { headers: { "Content-Type": "text/event-stream" } });
  });
  const response = await h.coordinator.fetch(request());
  assert.equal((await h.coordinator.fetch(request("POST", "/api/chat", NEXT_REQUEST))).status, 409);
  assert.equal((await h.coordinator.fetch(request("DELETE", "/api/history"))).status, 409);
  assert.equal((await h.coordinator.fetch(request("DELETE", "/api/chat", NEXT_REQUEST))).status, 409);
  assert.equal((await h.coordinator.fetch(request("DELETE", "/api/chat"))).status, 204);
  assert.equal((await events(response)).at(-1)?.code, "run_cancelled");
  assert.equal(cancelled, true);
  assert.deepEqual(h.store.history(), []);
  stalled = false;
  assert.equal((await events(await h.coordinator.fetch(request()))).at(-1)?.status, "done");
});

test("client stream cancellation does not persist a draft or leave the session busy", async () => {
  let stalled = true;
  const h = harness(async (req) => {
    const body = await req.json() as RunInput;
    return stalled
      ? new Response(new ReadableStream({ start(controller) { controller.enqueue(frame(progress())); } }),
        { headers: { "Content-Type": "text/event-stream" } })
      : upstream([...pipelineProgress(), completion(body)]);
  });
  const response = await h.coordinator.fetch(request());
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await Promise.all(h.tasks);
  assert.deepEqual(h.store.history(), []);
  stalled = false;
  assert.equal((await events(await h.coordinator.fetch(request()))).at(-1)?.status, "done");
});

test("startup and stream deadlines release reservations, including unresponsive backends", async () => {
  const startup = harness(() => new Promise(() => {}), 20);
  assert.equal((await startup.coordinator.fetch(request())).status, 504);
  assert.equal(startup.store.active(Date.now()), undefined);
  const streaming = harness(async () => new Response(new ReadableStream(), {
    headers: { "Content-Type": "text/event-stream" },
  }), 20);
  assert.equal((await events(await streaming.coordinator.fetch(request()))).at(-1)?.code, "run_timeout");
  assert.equal(streaming.store.active(Date.now()), undefined);
  assert.deepEqual(streaming.store.history(), []);
});

test("persisted leases recover after object failure and stale attempts cannot commit or release a retry", () => {
  const { store, database } = harness();
  const input = { prompt: "Hello", max_turns: 5 };
  store.claim(REQUEST, input, "old-token", 200, 100);
  const restarted = new SessionStore(database);
  assert.throws(() => restarted.claim(NEXT_REQUEST, input, "new-token", 300, 150), SessionError);
  restarted.claim(REQUEST, input, "new-token", 400, 250);
  store.release(REQUEST, "old-token");
  assert.throws(() => store.complete(REQUEST, "old-token", {
    status: "done", request_id: REQUEST, final_output: "Old", history_length: 2,
  }, 260), SessionError);
  restarted.complete(REQUEST, "new-token", {
    status: "done", request_id: REQUEST, final_output: "New", history_length: 2,
  }, 270);
  assert.equal(restarted.history()[1].content, "New");
});

test("concurrent startup reserves the session before awaiting the backend", async () => {
  let resolve: (response: Response) => void = () => { throw new Error("Not initialized"); };
  const h = harness(() => new Promise((done) => { resolve = done; }));
  const pending = h.coordinator.fetch(request());
  await setImmediate();
  assert.equal((await h.coordinator.fetch(request("POST", "/api/chat", NEXT_REQUEST))).status, 409);
  resolve(upstream([...pipelineProgress(), completion({ prompt: "Hello", max_turns: 5, request_id: REQUEST, history: [] })]));
  assert.equal((await events(await pending)).at(-1)?.status, "done");
});

for (const [name, backend] of [
  ["malformed JSON", async () => new Response("data: {broken}\n\n", { headers: { "Content-Type": "text/event-stream" } })],
  ["truncated frame", async () => new Response("data: {}", { headers: { "Content-Type": "text/event-stream" } })],
  ["missing completion", async () => upstream([progress()])],
  ["inconsistent history", async () => upstream([...pipelineProgress(), { status: "done", request_id: REQUEST, final_output: "Bad", history_length: 99 }])],
  ["wrong request ID", async () => upstream([...pipelineProgress(), { status: "done", request_id: NEXT_REQUEST, final_output: "Bad", history_length: 2 }])],
  ["events after completion", async () => upstream([...pipelineProgress(), { status: "done", request_id: REQUEST, final_output: "Bad", history_length: 2 }, progress()])],
  ["partial pipeline", async () => upstream([progress(), { status: "done", request_id: REQUEST, final_output: "Bad", history_length: 2 }])],
  ["startup failure", async () => new Response("Unavailable", { status: 503 })],
] as const) {
  test(`${name} never becomes successful history and can be retried`, async () => {
    let fail = true;
    const h = harness(async (req) => {
      if (fail) return backend();
      const body = await req.json() as RunInput;
      return upstream([...pipelineProgress(), completion(body)]);
    });
    const response = await h.coordinator.fetch(request());
    if (response.ok) assert.equal((await events(response)).at(-1)?.status, "error");
    else assert.equal(response.status, 502);
    assert.deepEqual(h.store.history(), []);
    fail = false;
    assert.equal((await events(await h.coordinator.fetch(request()))).at(-1)?.status, "done");
  });
}

test("a failed durable commit rolls back both messages and returns terminal error", async () => {
  const { database } = sqlite();
  const exec = database.sql.exec;
  database.sql.exec = (query, ...bindings) => {
    if (query.startsWith("UPDATE chat_requests")) throw new Error("Injected storage failure");
    return exec(query, ...bindings);
  };
  const h = harness(undefined, 1000, database);
  const result = await events(await h.coordinator.fetch(request()));
  assert.equal(result.at(-1)?.code, "storage_failed");
  assert.deepEqual(h.store.history(), []);
  assert.equal(h.store.active(Date.now()), undefined);
});

test("prompt and JSON size limits reject input before starting any backend calls", async () => {
  const h = harness();
  for (const prompt of ["a".repeat(8001), "a".repeat(131073)]) {
    assert.equal((await h.coordinator.fetch(request("POST", "/api/chat", REQUEST, { prompt }))).status, 413);
  }
  assert.equal(h.payloads.length, 0);
  const unicode = await events(await h.coordinator.fetch(request("POST", "/api/chat", REQUEST, {
    prompt: "\u{1f680}".repeat(8000),
  })));
  assert.equal(unicode.at(-1)?.status, "done");
});

test("oversized stored history stays available but cannot cause unbounded provider context", async () => {
  const h = harness();
  for (let turn = 0; turn < 3; turn++) {
    const id = crypto.randomUUID();
    h.store.claim(id, { prompt: "x".repeat(6000), max_turns: 5 }, id, Date.now() + 1000, Date.now());
    h.store.complete(id, id, {
      status: "done", request_id: id, final_output: "y".repeat(6000), history_length: (turn + 1) * 2,
    }, Date.now());
  }
  assert.equal((await h.coordinator.fetch(request())).status, 413);
  assert.equal(h.payloads.length, 0);
  assert.equal(h.store.history().length, 6);
});

test("known startup/provider errors are surfaced without forwarding backend secrets", async () => {
  const secret = "fake-provider-credential";
  const startup = harness(async () => Response.json({
    error: { code: "missing_configuration", message: secret },
  }, { status: 503 }));
  const response = await startup.coordinator.fetch(request());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes(secret), false);
  const streaming = harness(async () => upstream([
    progress(), { status: "error", code: "provider_rate_limit", message: secret },
  ]));
  const result = await events(await streaming.coordinator.fetch(request()));
  assert.equal(result.at(-1)?.code, "provider_rate_limit");
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(streaming.store.history(), []);
});

for (const code of ["knowledge_error", "knowledge_timeout", "knowledge_limit"]) {
  test(`${code} is sanitized, never committed, and permits retry`, async () => {
    let fail = true;
    const h = harness(async (req) => {
      if (fail) return upstream([progress(), { status: "error", code, message: "private-source-error" }]);
      const body = await req.json() as RunInput;
      return upstream([...pipelineProgress(), completion(body)]);
    });
    const result = await events(await h.coordinator.fetch(request()));
    assert.equal(result.at(-1)?.code, code);
    assert.equal(JSON.stringify(result).includes("private-source-error"), false);
    assert.deepEqual(h.store.history(), []);
    fail = false;
    assert.equal((await events(await h.coordinator.fetch(request()))).at(-1)?.status, "done");
  });
}
