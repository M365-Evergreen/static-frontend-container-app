import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { transferableAbortController } from "node:util";

// Node's Request cannot consume jsdom's AbortSignal; bridge cancellation between them.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const controller = transferableAbortController();
    const source = init?.signal;
    if (source?.aborted) controller.abort(source.reason);
    else
      source?.addEventListener("abort", () => controller.abort(source.reason), {
        once: true,
      });
    super(input, { ...init, signal: controller.signal });
  }
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

class TestResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver;
window.matchMedia = (query: string) => ({
  matches: query.includes("prefers-reduced-motion"),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
});

Element.prototype.scrollIntoView = () => {};
globalThis.CSS = {
  ...globalThis.CSS,
  escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
};
