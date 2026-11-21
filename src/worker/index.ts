import { Container, getContainer } from "@cloudflare/containers";
<<<<<<< HEAD
=======
import { SessionStore } from "./session-store.ts";
import { SessionCoordinator, errorResponse, uuidHeader } from "./session.ts";
import { SessionError } from "./session-store.ts";
import { prepareContainer } from "./container-ready.ts";
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)

export class AgentContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";

  envVars = {
    OPENAI_API_KEY: this.env.OPENAI_API_KEY ?? "",
<<<<<<< HEAD
  };

=======
    OPENAI_MODEL: this.env.OPENAI_MODEL,
  };

  private readonly session: SessionCoordinator;

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.session = new SessionCoordinator(
      new SessionStore(ctx.storage),
      (request) => this.runInContainer(request),
      (task) => ctx.waitUntil(task),
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

>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)
  override onStart() {
    console.log("Stateful AgentContainer started");
  }

  override onStop() {
    console.log("Stateful AgentContainer went to sleep");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
<<<<<<< HEAD
      const sessionId =
        request.headers.get("x-session-id") ||
        url.searchParams.get("sessionId") ||
        "default-session";

      // Routes all requests for this sessionId to the exact same stateful container
      const container = getContainer(env.AGENT_CONTAINER, sessionId);
      return container.fetch(request);
=======
      try {
        if (url.searchParams.has("sessionId")) {
          throw new SessionError("invalid_id", "Use the x-session-id header, not a query parameter.", 400);
        }
        const sessionId = uuidHeader(request, "x-session-id");
        const headers = new Headers(request.headers);
        headers.set("x-session-id", sessionId);
        return getContainer(env.AGENT_CONTAINER, sessionId).fetch(new Request(request, { headers }));
      } catch (error) {
        if (error instanceof SessionError) return errorResponse(error);
        throw error;
      }
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
