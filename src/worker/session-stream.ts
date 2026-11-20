import { SessionError } from "./session-store.ts";

export function frame(event: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new SessionError("input_limit", "JSON body exceeds its size limit.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export async function* readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let buffer = "";
  const cancel = () => {
    void reader.cancel().catch(() => {
      console.error(JSON.stringify({ event: "backend_reader_cancel_failed" }));
    });
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let separator = /\r?\n\r?\n/.exec(buffer);
      while (separator) {
        const text = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        if (text.length > 65536) {
          throw new SessionError("invalid_stream", "Backend SSE frame is too large.");
        }
        const data = text
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) {
          let event: unknown;
          try {
            event = JSON.parse(data);
          } catch {
            throw new SessionError("invalid_stream", "Backend returned malformed SSE JSON.");
          }
          yield event;
        } else if (text.trim() && !text.split(/\r?\n/).every((line) => line.startsWith(":"))) {
          throw new SessionError("invalid_stream", "Backend returned an invalid SSE frame.");
        }
        separator = /\r?\n\r?\n/.exec(buffer);
      }
      if (buffer.length > 65536) {
        throw new SessionError("invalid_stream", "Backend SSE frame is too large.");
      }
      if (done) break;
    }
    if (buffer.trim()) {
      throw new SessionError("invalid_stream", "Backend SSE stream was truncated.");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
