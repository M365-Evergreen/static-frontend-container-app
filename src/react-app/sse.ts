import { readApiError } from './chat/chat.api.ts';

export type AgentName = "planner_agent" | "research_agent" | "synthesizer_agent";

export interface RunningEvent {
  status: "running";
  turn: number;
  agent: AgentName;
  output: string;
}

export interface CompletionEvent {
  status: "done";
  request_id: string;
  final_output: string;
  history_length: number;
}

export interface ErrorEvent {
  status: "error";
  code: string;
  message: string;
}

export type SseEvent = RunningEvent | CompletionEvent | ErrorEvent;

export function isSseEvent(value: unknown): value is SseEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (event.status === "running") {
    return (
      Number.isInteger(event.turn) &&
      typeof event.turn === "number" && event.turn >= 1 && event.turn <= 3 &&
      event.agent === ["planner_agent", "research_agent", "synthesizer_agent"][event.turn - 1] &&
      typeof event.output === "string"
    );
  }
  if (event.status === "done") {
    return (
      typeof event.request_id === "string" &&
      typeof event.final_output === "string" &&
      typeof event.history_length === "number" && Number.isSafeInteger(event.history_length) &&
      event.history_length >= 2
    );
  }
  return (
    event.status === "error" &&
    typeof event.code === "string" &&
    typeof event.message === "string"
  );
}

export async function readSse(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  signal.throwIfAborted();
  if (!response.ok) throw new Error(await readApiError(response));
  if (!response.body) throw new Error("The conversation stream ended unexpectedly.");
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
    throw new Error("The server returned an unexpected response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let streamEnded = false;
  let cancellation: Promise<void> | undefined;
  const abort = () => {
    // An aborted stream may already be errored; the caller receives the abort reason.
    cancellation = reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });

  const processFrame = (frame: string) => {
    let eventData = "";
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        eventData += `${eventData ? "\n" : ""}${line.slice(5).trimStart()}`;
      }
    }
    if (!eventData) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(eventData);
    } catch {
      throw new Error("The server returned a malformed event.");
    }
    if (!isSseEvent(parsed)) throw new Error("The server returned an unknown event.");
    onEvent(parsed);
    if (parsed.status === "done" || parsed.status === "error") completed = true;
  };

  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        streamEnded = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        processFrame(buffer.slice(0, boundary.index));
        if (completed) return;
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processFrame(buffer);
  } finally {
    signal.removeEventListener('abort', abort);
    try {
      if (cancellation) {
        await cancellation;
      } else if (!streamEnded) {
        await reader.cancel();
      }
    } finally {
      reader.releaseLock();
    }
  }

  if (!completed) throw new Error("The conversation stream ended before completion.");
}

