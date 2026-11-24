import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadFile, listFiles } from "../../src/worker/files.ts";

test("lists five files through the bucket binding without exposing object content", async () => {
  const objects = Array.from({ length: 5 }, (_, index) => ({
    key: `document-${index}.pdf`,
    size: index * 1024,
    uploaded: new Date("2026-11-21T12:00:00Z"),
  }));
  const response = await listFiles(new Request("https://app.test/api/files"), {
    async list(options) {
      assert.deepEqual(options, { limit: 5 });
      return { objects, truncated: false };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    files: objects.map(({ key, size, uploaded }) => ({
      key,
      size,
      uploaded: uploaded.toISOString(),
    })),
  });
});

test("an empty bucket returns an empty list", async () => {
  const response = await listFiles(new Request("https://app.test/api/files"), {
    async list() {
      return { objects: [], truncated: false };
    },
  });
  assert.deepEqual(await response.json(), { files: [] });
});

test("lists a bounded page and returns an opaque cursor for the remaining bucket files", async () => {
  const response = await listFiles(
    new Request(
      "https://app.test/api/files?limit=100&cursor=previous%2B%2F%3D",
    ),
    {
      async list(options) {
        assert.deepEqual(options, { limit: 100, cursor: "previous+/=" });
        return {
          objects: [
            {
              key: "folder/file.pdf",
              size: 1024,
              uploaded: new Date("2026-11-24T12:00:00Z"),
            },
          ],
          truncated: true,
          cursor: "next+/=",
        };
      },
    },
  );
  assert.deepEqual(await response.json(), {
    files: [
      {
        key: "folder/file.pdf",
        size: 1024,
        uploaded: "2026-11-24T12:00:00.000Z",
      },
    ],
    nextCursor: "next+/=",
  });
});

test("the final page reports no next cursor", async () => {
  const response = await listFiles(
    new Request("https://app.test/api/files?limit=100"),
    {
      async list() {
        return { objects: [], truncated: false };
      },
    },
  );
  assert.deepEqual(await response.json(), { files: [], nextCursor: null });
});

test("invalid limits and empty cursors cannot access storage", async () => {
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=1.5",
    "limit=abc",
    "limit=",
    "cursor=",
  ]) {
    const response = await listFiles(
      new Request(`https://app.test/api/files?${query}`),
      {
        async list() {
          assert.fail("Invalid requests must not access storage");
        },
      },
    );
    assert.equal(response.status, 400);
  }
});

test("invalid bucket pagination fails explicitly instead of losing remaining files", async (context) => {
  const log = context.mock.method(console, "error", () => {});
  for (const cursor of [undefined, "previous"]) {
    const response = await listFiles(
      new Request("https://app.test/api/files?limit=100&cursor=previous"),
      {
        async list() {
          return { objects: [], truncated: true, cursor };
        },
      },
    );
    assert.equal(response.status, 503);
  }
  assert.equal(log.mock.callCount(), 2);
});

test("streams downloads with an encoded filename and safe cache and content headers", async () => {
  const key = "reports/Résumé & notes.pdf";
  const response = await downloadFile(
    new Request(
      `https://app.test/api/files/download?${new URLSearchParams({ key })}`,
    ),
    {
      async get(requestedKey) {
        assert.equal(requestedKey, key);
        return {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("file bytes"));
              controller.close();
            },
          }),
          size: 10,
          httpEtag: '"bucket-etag"',
          writeHttpMetadata(headers) {
            headers.set("Content-Type", "application/pdf");
            headers.set("Cache-Control", "public, max-age=3600");
          },
        };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "file bytes");
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(
    response.headers.get("Content-Disposition"),
    "attachment; filename*=UTF-8''R%C3%A9sum%C3%A9%20%26%20notes.pdf",
  );
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("ETag"), '"bucket-etag"');
  assert.equal(response.headers.get("Content-Length"), "10");
});

test("missing download objects return an explicit not-found response", async () => {
  const response = await downloadFile(
    new Request("https://app.test/api/files/download?key=missing.txt"),
    {
      async get() {
        return null;
      },
    },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: "file_not_found",
      message: "This file is no longer available.",
    },
  });
});

test("download failures do not expose private bucket details", async (context) => {
  const log = context.mock.method(console, "error", () => {});
  const response = await downloadFile(
    new Request("https://app.test/api/files/download?key=file.txt"),
    {
      async get() {
        throw new Error("Private bucket details");
      },
    },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: "storage_unavailable",
      message: "The file could not be downloaded. Try again.",
    },
  });
  assert.deepEqual(log.mock.calls[0].arguments, ["R2 file download failed."]);
});

test("invalid download keys and non-GET methods do not access storage", async () => {
  for (const request of [
    new Request("https://app.test/api/files/download"),
    new Request("https://app.test/api/files/download?key="),
    new Request(`https://app.test/api/files/download?key=${"x".repeat(1025)}`),
    new Request("https://app.test/api/files/download?key=file.txt", {
      method: "POST",
    }),
  ]) {
    const response = await downloadFile(request, {
      async get() {
        assert.fail("Invalid requests must not access storage");
      },
    });
    assert.equal(response.status, request.method === "GET" ? 400 : 405);
  }
});
test("storage failures are logged and returned as explicit errors", async (context) => {
  const log = context.mock.method(console, "error", () => {});
  const response = await listFiles(new Request("https://app.test/api/files"), {
    async list() {
      throw new Error("Private storage details");
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: "storage_unavailable",
      message: "Files could not be loaded. Try again.",
    },
  });
  assert.deepEqual(log.mock.calls[0].arguments, ["R2 file listing failed."]);
});

test("non-GET methods cannot access storage", async () => {
  const response = await listFiles(
    new Request("https://app.test/api/files", { method: "DELETE" }),
    {
      async list() {
        assert.fail("Storage must not be accessed");
      },
    },
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});
