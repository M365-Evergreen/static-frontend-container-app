import assert from "node:assert/strict";
import test from "node:test";

import { readSse, type SseEvent } from "../../src/react-app/sse.ts";

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

test("reads SSE frames across arbitrary chunk boundaries", async () => {
  const payload = JSON.stringify({
    status: "done",
    request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    final_output: "Complete answer",
    history_length: 2,
  });
  const frame = `data: ${payload}\n\n`;
  const midpoint = 11;
  const events: SseEvent[] = [];

  await readSse(
    streamResponse([frame.slice(0, midpoint), frame.slice(midpoint)]),
    new AbortController().signal,
    (event) => events.push(event),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].status, "done");
});

test("rejects malformed JSON frames", async () => {
  await assert.rejects(
    readSse(
      streamResponse(["data: {not-json}\n\n"]),
      new AbortController().signal,
      () => undefined,
    ),
    /malformed event/,
  );
});

test("rejects streams that end before completion", async () => {
  await assert.rejects(
    readSse(
      streamResponse(["data: {\"status\":\"running\",\"turn\":1,\"agent\":\"planner_agent\",\"output\":\"Plan\"}\n\n"]),
      new AbortController().signal,
      () => undefined,
    ),
    /ended before completion/,
  );
});

test("accepts terminal error events", async () => {
  const events: SseEvent[] = [];
  await readSse(
    streamResponse([
      "data: {\"status\":\"error\",\"code\":\"provider_error\",\"message\":\"OpenAI failed.\"}\n\n",
    ]),
    new AbortController().signal,
    (event) => events.push(event),
  );
  assert.equal(events[0].status, "error");
});
