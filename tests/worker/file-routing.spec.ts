import { webcrypto } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../../src/worker/index.ts";

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
  getContainer: vi.fn(),
}));

const teamDomain = "paulibaby.cloudflareaccess.com";
const audience =
  "3cca06c718eeae1d5f9104416620e620e64b0772bc9de4b732f4799e472f3603";
let token: string;

beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-upload-key" })
    .setIssuer(`https://${teamDomain}`)
    .setAudience(audience)
    .setSubject("upload-test-user")
    .setExpirationTime("1h")
    .sign(privateKey);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ keys: [{ ...jwk, kid: "test-upload-key" }] }),
    ),
  );
});

it("routes authenticated uploads to R2 without transferring their request body to assets", async () => {
  const key = "DocumentPreviewContent.tsx";
  const content = "export const original = 'unchanged';\n";
  const uploaded = new Date("2026-11-25T12:00:00Z");
  const put = vi.fn<R2Bucket["put"]>(async (path, body, options) => {
    expect(path).toBe(key);
    if (
      !(body instanceof Uint8Array) ||
      !(options?.onlyIf instanceof Headers)
    ) {
      throw new Error("Expected buffered content and conditional headers.");
    }
    expect(new TextDecoder().decode(body)).toBe(content);
    expect(options.onlyIf.get("If-None-Match")).toBe("*");
    expect(options.httpMetadata).toEqual({ contentType: "text/plain" });
    return {
      key,
      size: content.length,
      uploaded,
      version: "test-version",
      etag: "test-etag",
      httpEtag: '"test-etag"',
      checksums: { toJSON: () => ({}) },
      storageClass: "Standard",
      writeHttpMetadata() {},
    };
  });
  const unexpectedBinding = () => {
    throw new Error("An upload must not call unrelated bindings.");
  };
  const assets = vi.fn(unexpectedBinding);
  const env: Env = {
    CF_ACCESS_TEAM_DOMAIN: teamDomain,
    CF_ACCESS_AUDIENCE: audience,
    R2: {
      put,
      head: unexpectedBinding,
      get: unexpectedBinding,
      list: unexpectedBinding,
      delete: unexpectedBinding,
      createMultipartUpload: unexpectedBinding,
      resumeMultipartUpload: unexpectedBinding,
    },
    ASSETS: { fetch: assets, connect: unexpectedBinding },
    DB: {} as D1Database,
    AI: {} as Ai,
    AGENT_CONTAINER: {} as Env["AGENT_CONTAINER"],
    KNOWLEDGE_MCP_URL:
      "https://9904ca51-56e6-48cd-ae7e-3e0f154d2724.search.ai.cloudflare.com/mcp",
    LLM_MODEL: "gemini-3.8-flash",
    LLM_PROVIDER: "gemini",
    OPENAI_API_KEY: "",
    MISTRAL_API_KEY: "",
    LLM_API_KEY: "",
  };
  const incoming = new Request(
    `https://app.test/api/files/upload?${new URLSearchParams({ key })}`,
    {
      method: "PUT",
      body: content,
      headers: {
        "Cf-Access-Jwt-Assertion": token,
        "Content-Type": "text/plain",
      },
    },
  );
  const response = await worker.fetch(incoming, env, {} as ExecutionContext);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    file: { key, size: content.length, uploaded: uploaded.toISOString() },
  });
  expect(put).toHaveBeenCalledOnce();
  expect(assets).not.toHaveBeenCalled();
});
