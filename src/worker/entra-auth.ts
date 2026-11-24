import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { SessionError } from "./session-store.ts";

export interface EntraEnvironment {
  ENTRA_TENANT_ID?: string;
  ENTRA_CLIENT_ID?: string;
  ENTRA_API_AUDIENCE?: string;
  ENTRA_API_SCOPE?: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keySets = new Map<string, JWTVerifyGetKey>();

export function entraConfiguration(env: EntraEnvironment) {
  const tenantId = env.ENTRA_TENANT_ID?.trim().toLowerCase() ?? "";
  const clientId = env.ENTRA_CLIENT_ID?.trim().toLowerCase() ?? "";
  const audience = env.ENTRA_API_AUDIENCE?.trim().toLowerCase() ?? "";
  const scope = env.ENTRA_API_SCOPE?.trim() ?? "";
  const prefix = `api://${audience}/`;
  if (
    !GUID.test(tenantId) || !GUID.test(clientId) || !GUID.test(audience) ||
    !scope.startsWith(prefix) || !/^[a-zA-Z0-9._-]+$/.test(scope.slice(prefix.length))
  ) {
    throw new SessionError(
      "authentication_not_configured",
      "Microsoft Entra sign-in is not configured. Set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_API_AUDIENCE and ENTRA_API_SCOPE.",
      503,
    );
  }
  return {
    tenantId, clientId, audience, scope,
    authority: `https://login.microsoftonline.com/${tenantId}`,
  };
}

export async function authenticateEntra(
  request: Request,
  env: EntraEnvironment,
  keys?: JWTVerifyGetKey,
): Promise<string> {
  const config = entraConfiguration(env);
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) {
    throw new SessionError("authentication_required", "Sign in with Microsoft to access chat history.", 401);
  }
  const jwksUrl = `${config.authority}/discovery/v2.0/keys`;
  if (!keys) {
    keys = keySets.get(jwksUrl);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 5000 });
      keySets.set(jwksUrl, keys);
    }
  }
  try {
    const { payload } = await jwtVerify(authorization.slice(7), keys, {
      algorithms: ["RS256"],
      issuer: `${config.authority}/v2.0`,
      audience: config.audience,
      requiredClaims: ["exp", "nbf", "iat", "tid", "oid", "scp", "azp"],
      clockTolerance: 5,
    });
    if (
      payload.ver !== "2.0" || payload.tid !== config.tenantId ||
      typeof payload.oid !== "string" || !GUID.test(payload.oid) ||
      payload.azp !== config.clientId || typeof payload.scp !== "string" ||
      !payload.scp.split(" ").includes(config.scope.slice(config.scope.lastIndexOf("/") + 1))
    ) {
      throw new SessionError("access_denied", "This token does not grant access to chat history.", 403);
    }
    return `${config.tenantId}:${payload.oid.toLowerCase()}`;
  } catch (error) {
    if (error instanceof SessionError) throw error;
    if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
      throw new SessionError("invalid_token", "Your Microsoft sign-in is invalid or expired. Sign in again.", 401);
    }
    console.error(JSON.stringify({ event: "entra_verification_unavailable" }));
    throw new SessionError("authentication_unavailable", "Microsoft sign-in verification is temporarily unavailable.", 503);
  }
}
