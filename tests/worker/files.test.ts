import assert from "node:assert/strict";
import { test } from "node:test";
import { listFiles } from "../../src/worker/files.ts";

test("lists five files through the bucket binding without exposing object content", async () => {
  const objects = Array.from({ length: 5 }, (_, index) => ({
    key: `document-${index}.pdf`,
    size: index * 1024,
    uploaded: new Date("2026-11-21T12:00:00Z"),
  }));
  const response = await listFiles(new Request("https://app.test/api/files"), {
    async list(options) {
      assert.deepEqual(options, { limit: 5 });
      return { objects };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    files: objects.map(({ key, size, uploaded }) => ({ key, size, uploaded: uploaded.toISOString() })),
  });
});

test("an empty bucket returns an empty list", async () => {
  const response = await listFiles(new Request("https://app.test/api/files"), {
    async list() { return { objects: [] }; },
  });
  assert.deepEqual(await response.json(), { files: [] });
});

test("storage failures are logged and returned as explicit errors", async (context) => {
  const log = context.mock.method(console, "error", () => {});
  const response = await listFiles(new Request("https://app.test/api/files"), {
    async list() { throw new Error("Private storage details"); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "storage_unavailable", message: "Files could not be loaded. Try again." },
  });
  assert.deepEqual(log.mock.calls[0].arguments, ["R2 file listing failed."]);
});

test("non-GET methods cannot access storage", async () => {
  const response = await listFiles(new Request("https://app.test/api/files", { method: "DELETE" }), {
    async list() { assert.fail("Storage must not be accessed"); },
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});
