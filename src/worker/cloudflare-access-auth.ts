import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { SessionError } from "./session-store.ts";

export interface CloudflareAccessEnvironment {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUDIENCE?: string;
}

export interface CloudflareAccessIdentity {
  ownerId: string;
  name: string;
}

const keySets = new Map<string, JWTVerifyGetKey>();

export function accessConfiguration(env: CloudflareAccessEnvironment) {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "") ?? "";
  const audience = env.CF_ACCESS_AUDIENCE?.trim() ?? "";
  if (!teamDomain || !/^[a-z0-9][a-z0-9.-]*\.cloudflareaccess\.com$/.test(teamDomain) || !audience) {
    throw new SessionError(
      "authentication_not_configured",
      "Cloudflare Access is not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUDIENCE.",
      503,
    );
  }
  return {
    teamDomain,
    audience,
    issuer: `https://${teamDomain}`,
  };
}

export async function authenticateCloudflareAccess(
  request: Request,
  env: CloudflareAccessEnvironment,
  keys?: JWTVerifyGetKey,
): Promise<CloudflareAccessIdentity> {
  const config = accessConfiguration(env);
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion) {
    throw new SessionError("authentication_required", "Sign in through Cloudflare Access to use chat.", 401);
  }
  const jwksUrl = `${config.issuer}/cdn-cgi/access/certs`;
  if (!keys) {
    keys = keySets.get(jwksUrl);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 5000 });
      keySets.set(jwksUrl, keys);
    }
  }
  try {
    const { payload } = await jwtVerify(assertion, keys, {
      algorithms: ["RS256"],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ["exp", "iat", "sub"],
      clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      throw new SessionError("access_denied", "This Cloudflare Access identity does not grant chat access.", 403);
    }
    const name = typeof payload.email === "string" && payload.email
      ? payload.email
      : "Cloudflare Access user";
    return { ownerId: `access:${payload.sub}`, name };
  } catch (error) {
    if (error instanceof SessionError) throw error;
    if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
      throw new SessionError("invalid_token", "Your Cloudflare Access session is invalid or expired.", 401);
    }
    console.error(JSON.stringify({ event: "cloudflare_access_verification_unavailable" }));
    throw new SessionError("authentication_unavailable", "Cloudflare Access verification is temporarily unavailable.", 503);
  }
}
