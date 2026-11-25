import { D1ChatHistory } from "./chat-history.ts";
import {
  authenticateCloudflareAccess,
  type CloudflareAccessEnvironment,
} from "./cloudflare-access-auth.ts";
import { SessionError } from "./session-store.ts";
import { errorResponse, uuidHeader } from "./session.ts";

export async function handleChatRequest(
  request: Request,
  env: CloudflareAccessEnvironment & { DB: ConstructorParameters<typeof D1ChatHistory>[0] },
  forward: (sessionId: string, request: Request) => Promise<Response>,
  authenticate = authenticateCloudflareAccess,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!["/api/auth/status", "/api/chat", "/api/history", "/api/conversations"].includes(url.pathname)) {
      throw new SessionError("not_found", "Unknown conversation endpoint.", 404);
    }
    const identity = await authenticate(request, env);
    const ownerId = identity.ownerId;
    if (url.pathname === "/api/auth/status") {
      if (request.method !== "GET") throw new SessionError("method_not_allowed", "Use GET to check authentication.", 405);
      return Response.json({ id: ownerId, name: identity.name }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (url.pathname === "/api/conversations") {
      if (request.method !== "GET") throw new SessionError("method_not_allowed", "Use GET to list conversations.", 405);
      return Response.json(await new D1ChatHistory(env.DB).list(ownerId, url), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (url.pathname === "/api/history" && request.method === "GET") {
      const sessionId = uuidHeader(request, "x-session-id");
      return Response.json(await new D1ChatHistory(env.DB).load(ownerId, sessionId), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (url.searchParams.has("sessionId")) {
      throw new SessionError("invalid_id", "Use the x-session-id header, not a query parameter.", 400);
    }
    const sessionId = uuidHeader(request, "x-session-id");
    const headers = new Headers(request.headers);
    headers.set("x-session-id", sessionId);
    headers.set("x-chat-owner", ownerId);
    headers.delete("cf-access-jwt-assertion");
    headers.delete("authorization");
    headers.delete("cf-access-authenticated-user-email");
    return await forward(sessionId, new Request(request, { headers }));
  } catch (error) {
    if (error instanceof SessionError) return errorResponse(error);
    console.error(JSON.stringify({ event: "chat_request_failed" }));
    return errorResponse(new SessionError("chat_unavailable", "Conversation storage is temporarily unavailable.", 503));
  }
}
