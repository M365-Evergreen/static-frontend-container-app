import { Container, getContainer } from "@cloudflare/containers";

export class AgentContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";

  envVars = {
    OPENAI_API_KEY: this.env.OPENAI_API_KEY ?? "",
  };

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
      const sessionId =
        request.headers.get("x-session-id") ||
        url.searchParams.get("sessionId") ||
        "default-session";

      // Routes all requests for this sessionId to the exact same stateful container
      const container = getContainer(env.AGENT_CONTAINER, sessionId);
      return container.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
