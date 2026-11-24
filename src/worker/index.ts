import { Container, getContainer } from "@cloudflare/containers";
import { SessionStore } from "./session-store.ts";
import { SessionCoordinator, errorResponse, uuidHeader } from "./session.ts";
import { SessionError } from "./session-store.ts";
import { prepareContainer } from "./container-ready.ts";
import { downloadFile, listFiles, writeFile } from "./files.ts";
import {
  indexUploadedObjectAsync,
  reconcileBucket,
  drainPending,
  searchFiles,
} from "./fileIndex";




export class AgentContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";

  envVars = {
    LLM_API_KEY: this.env.LLM_API_KEY ?? "",
    LLM_PROVIDER: this.env.LLM_PROVIDER,
    LLM_MODEL: this.env.LLM_MODEL,
    KNOWLEDGE_MCP_URL: this.env.KNOWLEDGE_MCP_URL,
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

  override onStart() {
    console.log("Stateful AgentContainer started");
  }

  override onStop() {
    console.log("Stateful AgentContainer went to sleep");
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "PUT" && url.pathname.startsWith("/upload/")) {
      const key = url.pathname.slice("/upload/".length);
      await env.R2.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get("content-type") ?? undefined },
      });
      indexUploadedObjectAsync(env, key, ctx);        // strategy 1
      return new Response("uploaded", { status: 201 });
    }
    if (url.pathname === "/api/files/search") {
      return Response.json(await searchFiles(env, url.searchParams.get("q") ?? ""));
    }
    if (url.pathname === "/api/files/index") {
      return Response.json(await reconcileBucket(env));
    }
    if (url.pathname === "/api/files/drain") {
      return Response.json(await drainPending(env, { limit: 200 }));
    }

    if (url.pathname === "/api/files") {
      return listFiles(request, env.R2);
    }
    if (url.pathname === "/api/files/download") {
      return downloadFile(request, env.R2);
    }
    if (url.pathname === "/api/files/upload") {
      return writeFile(request, env.R2);
    }
    if (url.pathname === "/api/files/folder") {
      return writeFile(request, env.R2, true);
    }

    if (url.pathname.startsWith("/api/")) {
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
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
