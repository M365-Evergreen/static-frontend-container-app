import { D1ChatHistory } from "./chat-history.ts";
import { authenticateEntra, entraConfiguration, type EntraEnvironment } from "./entra-auth.ts";
import { SessionError } from "./session-store.ts";
import { errorResponse, uuidHeader } from "./session.ts";

export async function handleChatRequest(
  request: Request,
  env: EntraEnvironment & { DB: ConstructorParameters<typeof D1ChatHistory>[0] },
  forward: (sessionId: string, request: Request) => Promise<Response>,
  authenticate = authenticateEntra,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/auth/config" && request.method === "GET") {
      const { tenantId, clientId, authority, scope } = entraConfiguration(env);
      return Response.json({ tenantId, clientId, authority, scope }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (!["/api/chat", "/api/history", "/api/conversations"].includes(url.pathname)) {
      throw new SessionError("not_found", "Unknown conversation endpoint.", 404);
    }
    const ownerId = await authenticate(request, env);
    if (url.pathname === "/api/conversations") {
      if (request.method !== "GET") throw new SessionError("method_not_allowed", "Use GET to list conversations.", 405);
      return Response.json(await new D1ChatHistory(env.DB).list(ownerId, url), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (url.searchParams.has("sessionId")) {
      throw new SessionError("invalid_id", "Use the x-session-id header, not a query parameter.", 400);
    }
    const sessionId = uuidHeader(request, "x-session-id");
    const headers = new Headers(request.headers);
    headers.set("x-session-id", sessionId);
    // This identity is internal to the Worker -> Durable Object boundary, never client supplied.
    headers.set("x-chat-owner", ownerId);
    headers.delete("authorization");
    return await forward(sessionId, new Request(request, { headers }));
  } catch (error) {
    if (error instanceof SessionError) return errorResponse(error);
    console.error(JSON.stringify({ event: "chat_request_failed" }));
    return errorResponse(new SessionError("chat_unavailable", "Conversation storage is temporarily unavailable.", 503));
  }
}
