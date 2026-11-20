import {
  SessionError,
  SessionStore,
  type ChatInput,
  type Completion,
} from "./session-store.ts";
import { abortable, frame, readBoundedText, readEvents } from "./session-stream.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-store",
};
const PIPELINE_AGENTS = ["planner_agent", "research_agent", "synthesizer_agent"] as const;
const MAX_PROMPT_CHARS = 8000;
const MAX_HISTORY_CHARS = 24000;
const MAX_HISTORY_MESSAGES = 100;
const BACKEND_ERRORS = {
  missing_configuration: [503, "LLM_API_KEY is not configured."],
  invalid_configuration: [503, "Set LLM_PROVIDER to gemini or nvidia and LLM_MODEL to a nonblank model name."],
  invalid_input: [422, "The run payload is invalid."],
  input_limit: [413, "The prompt or conversation exceeds its size limit."],
  provider_authentication: [502, "Model provider authentication failed."],
  provider_rate_limit: [429, "The model provider's rate or quota limit was reached."],
  provider_timeout: [504, "A model provider request timed out."],
  provider_unavailable: [503, "The model provider could not be reached."],
  provider_error: [502, "The model provider rejected or failed the request."],
  provider_refusal: [502, "The model provider declined to produce an answer."],
  invalid_response: [502, "The model provider returned no complete usable text."],
  output_limit: [502, "An agent exceeded its output limit."],
  run_timeout: [504, "The agent pipeline exceeded its deadline."],
  agent_failed: [502, "The agent pipeline failed."],
} as const;

export function uuidHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value || !UUID.test(value)) {
    throw new SessionError("invalid_id", `${name} must be a UUID.`, 400);
  }
  return value.toLowerCase();
}

export function errorResponse(error: SessionError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function backendError(value: unknown): SessionError | undefined {
  if (!record(value) || typeof value.code !== "string") return undefined;
  for (const [code, [status, message]] of Object.entries(BACKEND_ERRORS)) {
    if (value.code === code) return new SessionError(code, message, status);
  }
  return undefined;
}

async function inputFrom(request: Request): Promise<ChatInput> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new SessionError("invalid_input", "Content-Type must be application/json.", 415);
  }
  let input: unknown;
  try {
    input = JSON.parse(await readBoundedText(request.body, 131072));
  } catch (error) {
    if (error instanceof SessionError) throw error;
    throw new SessionError("invalid_input", "Request body must be valid JSON.", 400);
  }
  if (
    !record(input) ||
    Object.keys(input).some((key) => key !== "prompt" && key !== "max_turns") ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim()
  ) {
    throw new SessionError("invalid_input", "Only prompt and max_turns are accepted.", 400);
  }
  if (Array.from(input.prompt).length > MAX_PROMPT_CHARS) {
    throw new SessionError("input_limit", "Prompt exceeds 8000 characters.", 413);
  }
  const maxTurns = input.max_turns === undefined ? 5 : input.max_turns;
  if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 3 || maxTurns > 10) {
    throw new SessionError("invalid_input", "max_turns must be an integer from 3 to 10.", 400);
  }
  return { prompt: input.prompt, max_turns: maxTurns };
}

interface ActiveRun {
  requestId: string;
  token: string;
  abort: AbortController;
}

export class SessionCoordinator {
  private current?: ActiveRun;

  constructor(
    private readonly store: SessionStore,
    private readonly backend: (request: Request) => Promise<Response>,
    private readonly waitUntil: (task: Promise<void>) => void,
    private readonly timeoutMs = 120000,
  ) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const sessionId = uuidHeader(request, "x-session-id");
      this.store.identify(sessionId);
      const path = new URL(request.url).pathname;
      if (path === "/api/history" && request.method === "GET") {
        return Response.json(
          { session_id: sessionId, messages: this.store.history() },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (path === "/api/history" && request.method === "DELETE") {
        this.store.clear(Date.now());
        return new Response(null, { status: 204 });
      }
      if (path === "/api/chat" && request.method === "DELETE") {
        const requestId = uuidHeader(request, "x-request-id");
        if (this.current?.requestId !== requestId || !this.store.active(Date.now())) {
          throw new SessionError("run_not_active", "No matching active run exists.", 409);
        }
        this.current.abort.abort(
          new SessionError("run_cancelled", "The run was cancelled.", 408),
        );
        this.store.release(requestId, this.current.token);
        this.current = undefined;
        return new Response(null, { status: 204 });
      }
      if (path !== "/api/chat" || request.method !== "POST") {
        throw new SessionError("not_found", "Unknown conversation endpoint.", 404);
      }
      const requestId = uuidHeader(request, "x-request-id");
      const input = await inputFrom(request);
      const token = crypto.randomUUID();
      const deadline = Date.now() + this.timeoutMs;
      const replay = this.store.claim(requestId, input, token, deadline, Date.now());
      if (replay) {
        return new Response(frame(replay), { headers: SSE_HEADERS });
      }
      return await this.run(request, sessionId, requestId, token, input, deadline);
    } catch (error) {
      if (error instanceof SessionError) return errorResponse(error);
      console.error(JSON.stringify({ event: "session_request_failed" }));
      return errorResponse(new SessionError("internal_error", "Session storage failed.", 500));
    }
  }

  private async run(
    request: Request,
    sessionId: string,
    requestId: string,
    token: string,
    input: ChatInput,
    deadline: number,
  ): Promise<Response> {
    const abort = new AbortController();
    const active = { requestId, token, abort };
    this.current = active;
    const interrupted = () => abort.abort(new SessionError("run_cancelled", "The run was cancelled.", 408));
    request.signal.addEventListener("abort", interrupted, { once: true });
    if (request.signal.aborted) interrupted();
    const timeout = setTimeout(
      () => abort.abort(new SessionError("run_timeout", "The run exceeded its deadline.", 504)),
      Math.max(0, deadline - Date.now()),
    );
    const cleanup = () => {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", interrupted);
      if (this.current === active) this.current = undefined;
      this.store.release(requestId, token);
    };
    const failure = (error: unknown) => {
      const result = error instanceof SessionError
        ? error
        : new SessionError("backend_failed", "The backend run failed.");
      console.error(JSON.stringify({
        event: "chat_run_failed", session_id: sessionId, request_id: requestId, code: result.code,
      }));
      return result;
    };
    try {
      const history = this.store.history();
      if (
        history.length > MAX_HISTORY_MESSAGES ||
        history.reduce((sum, message) => sum + Array.from(message.content).length, 0) > MAX_HISTORY_CHARS ||
        history.some((message) => Array.from(message.content).length > MAX_PROMPT_CHARS)
      ) {
        throw new SessionError("input_limit", "Conversation history exceeds its size limit.", 413);
      }
      const upstream = await abortable(this.backend(new Request("http://container/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-id": sessionId },
        body: JSON.stringify({
          ...input,
          request_id: requestId,
          history: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: abort.signal,
      })), abort.signal);
      if (!upstream.ok && upstream.headers.get("content-type")?.split(";")[0] === "application/json") {
        let payload: unknown;
        try {
          payload = JSON.parse(await abortable(readBoundedText(upstream.body, 4096), abort.signal));
        } catch {
          if (abort.signal.aborted) throw abort.signal.reason;
          throw new SessionError("backend_failed", "Backend returned an invalid error.");
        }
        const error = record(payload) ? backendError(payload.error) : undefined;
        throw error ?? new SessionError("backend_failed", "Backend did not start an SSE run.");
      }
      if (
        !upstream.ok ||
        !upstream.body ||
        upstream.headers.get("content-type")?.split(";")[0] !== "text/event-stream"
      ) {
        if (upstream.body) await upstream.body.cancel();
        throw new SessionError("backend_failed", "Backend did not start an SSE run.");
      }
      const body = upstream.body;
      let disconnected = false;
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          const pump = async () => {
            try {
              let completion: Completion | undefined;
              let turn = 0;
              for await (const event of readEvents(body, abort.signal)) {
                if (!record(event) || completion) {
                  throw new SessionError("invalid_stream", "Backend returned an invalid event sequence.");
                }
                if (event.status === "done") {
                  if (
                    event.request_id !== requestId ||
                    typeof event.final_output !== "string" ||
                    !event.final_output.trim() ||
                    Array.from(event.final_output).length > MAX_PROMPT_CHARS ||
                    event.history_length !== history.length + 2 ||
                    turn !== PIPELINE_AGENTS.length
                  ) {
                    throw new SessionError("invalid_completion", "Backend returned invalid completion.");
                  }
                  completion = {
                    status: "done",
                    request_id: requestId,
                    final_output: event.final_output,
                    history_length: history.length + 2,
                  };
                } else if (
                  event.status === "running" &&
                  event.turn === turn + 1 &&
                  event.agent === PIPELINE_AGENTS[turn] &&
                  typeof event.output === "string" &&
                  event.output.trim().length > 0 &&
                  Array.from(event.output).length <= MAX_PROMPT_CHARS &&
                  turn < input.max_turns &&
                  turn < PIPELINE_AGENTS.length
                ) {
                  turn++;
                  controller.enqueue(frame(event));
                } else if (event.status === "error") {
                  throw backendError(event) ?? new SessionError("backend_failed", "Backend returned an invalid error.");
                } else {
                  throw new SessionError("invalid_stream", "Backend returned an invalid progress event.");
                }
              }
              if (abort.signal.aborted) throw abort.signal.reason;
              if (!completion) {
                throw new SessionError("incomplete_stream", "Backend closed without completing the run.");
              }
              try {
                this.store.complete(requestId, token, completion, Date.now());
              } catch (error) {
                if (error instanceof SessionError) throw error;
                throw new SessionError("storage_failed", "Completed turn could not be persisted.", 500);
              }
              controller.enqueue(frame(completion));
            } catch (error) {
              const result = failure(error);
              if (!disconnected) {
                controller.enqueue(frame({ status: "error", code: result.code, message: result.message }));
              }
            } finally {
              try {
                cleanup();
              } finally {
                if (!disconnected) controller.close();
              }
            }
          };
          this.waitUntil(pump());
        },
        cancel: () => {
          disconnected = true;
          interrupted();
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    } catch (error) {
      cleanup();
      return errorResponse(failure(error));
    }
  }
}
