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

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    return payload.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export function isSseEvent(value: unknown): value is SseEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  if (event.status === "running") {
    return (
      typeof event.turn === "number" &&
      (event.agent === "planner_agent" ||
        event.agent === "research_agent" ||
        event.agent === "synthesizer_agent") &&
      typeof event.output === "string"
    );
  }
  if (event.status === "done") {
    return (
      typeof event.request_id === "string" &&
      typeof event.final_output === "string" &&
      typeof event.history_length === "number"
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
  if (!response.ok) throw new Error(await readApiError(response));
  if (!response.body) throw new Error("The conversation stream ended unexpectedly.");
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
    throw new Error("The server returned an unexpected response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        processFrame(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processFrame(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!completed) throw new Error("The conversation stream ended before completion.");
  void signal;
}
