import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "../../src/worker/files.ts";

type Bucket = Parameters<typeof writeFile>[1];
const uploaded = new Date("2026-11-25T12:00:00Z");

function request(
  key: string,
  body?: string,
  headers?: Record<string, string>,
  folder = false,
) {
  return new Request(
    `https://app.test/api/files/${folder ? "folder" : "upload"}?${new URLSearchParams({ key })}`,
    {
      method: folder ? "POST" : "PUT",
      body,
      headers,
    },
  );
}

function untouchedBucket(): Bucket {
  return {
    async put() {
      assert.fail("Invalid requests must not write objects");
    },
    async head() {
      assert.fail("Invalid requests must not read objects");
    },
  };
}

test("streams original file content and metadata with an atomic create-only condition", async () => {
  const key = "reports/Q&A #1.csv";
  const incoming = request(key, "name,value\nreport,42\n", {
    "Content-Type": "text/csv",
  });
  const response = await writeFile(incoming, {
    async put(path, body, options) {
      assert.equal(path, key);
      assert.ok(body instanceof Uint8Array);
      assert.equal(await new Response(body).text(), "name,value\nreport,42\n");
      assert.equal(options.onlyIf.get("If-None-Match"), "*");
      assert.equal(options.onlyIf.has("If-Match"), false);
      assert.equal(options.httpMetadata.contentType, "text/csv");
      return { key, size: 21, uploaded };
    },
    async head() {
      assert.fail("Successful writes do not need an unsafe preflight check");
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    file: { key, size: 21, uploaded: uploaded.toISOString() },
  });
});

test("creates empty files and persistent zero-byte folder markers", async () => {
  for (const folder of [false, true]) {
    const key = folder ? "reports/empty/" : "empty.txt";
    const response = await writeFile(
      request(key, undefined, undefined, folder),
      {
        async put(path, body, options) {
          assert.equal(path, key);
          assert.equal((await new Response(body).arrayBuffer()).byteLength, 0);
          assert.equal(options.onlyIf.get("If-None-Match"), "*");
          assert.equal(
            options.httpMetadata.contentType,
            folder ? "application/x-directory" : "application/octet-stream",
          );
          return { key, size: 0, uploaded };
        },
        async head() {
          return null;
        },
      },
      folder,
    );
    assert.equal(response.status, 201);
  }
});

test("a create conflict returns the current ETag without retrying or overwriting", async () => {
  let attempts = 0;
  const response = await writeFile(request("notes.md", "replacement"), {
    async put(_key, _body, options) {
      attempts++;
      assert.equal(options.onlyIf.get("If-None-Match"), "*");
      return null;
    },
    async head() {
      return { httpEtag: '"existing"' };
    },
  });
  assert.equal(attempts, 1);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "file_exists",
      message: "A file with this path already exists.",
      etag: '"existing"',
    },
  });
});

test("confirmed replacement uses an exact compare-and-swap and returns a fresh conflict on concurrent changes", async () => {
  for (const changed of [false, true]) {
    const response = await writeFile(
      request("notes.md", "replacement", { "If-Match": '"confirmed"' }),
      {
        async put(_key, _body, options) {
          assert.equal(options.onlyIf.get("If-Match"), '"confirmed"');
          assert.equal(options.onlyIf.has("If-None-Match"), false);
          return changed ? null : { key: "notes.md", size: 11, uploaded };
        },
        async head() {
          return { httpEtag: '"concurrent-update"' };
        },
      },
    );
    assert.equal(response.status, changed ? 409 : 200);
    if (changed) {
      const payload = (await response.json()) as {
        error: { code: string; etag: string };
      };
      assert.equal(payload.error.code, "file_changed");
      assert.equal(payload.error.etag, '"concurrent-update"');
    }
  }
});

test("invalid paths and replacement conditions cannot access the bucket", async () => {
  for (const key of [
    "",
    "/root.txt",
    "../file",
    "a/../b",
    "a/./b",
    "a//b",
    "folder/",
    "a\\b",
    "a\u0000b",
    "x".repeat(1025),
    "\u00e9".repeat(513),
  ]) {
    assert.equal(
      (await writeFile(request(key, "content"), untouchedBucket())).status,
      400,
      key,
    );
  }
  for (const etag of ["*", '"*"', "unquoted", 'W/"weak"', '"a", "b"']) {
    assert.equal(
      (
        await writeFile(
          request("safe.txt", "content", { "If-Match": etag }),
          untouchedBucket(),
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await writeFile(
        request("folder/", "content", undefined, true),
        untouchedBucket(),
        true,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await writeFile(
        request("folder/", undefined, { "If-Match": '"etag"' }, true),
        untouchedBucket(),
        true,
      )
    ).status,
    400,
  );
});

test("cross-origin writes and incorrect methods are rejected before storage", async () => {
  const crossOriginHeaders: Record<string, string>[] = [
    { Origin: "https://other.test" },
    { "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of crossOriginHeaders) {
    assert.equal(
      (await writeFile(request("file.txt", "data", headers), untouchedBucket()))
        .status,
      403,
    );
  }
  for (const folder of [false, true]) {
    const response = await writeFile(
      new Request("https://app.test/api/files/upload"),
      untouchedBucket(),
      folder,
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), folder ? "POST" : "PUT");
  }
});

test("existing folders are not replaced and storage errors do not leak private details", async (context) => {
  const conflict = await writeFile(
    request("empty/", undefined, undefined, true),
    {
      async put() {
        return null;
      },
      async head() {
        return { httpEtag: '"folder"' };
      },
    },
    true,
  );
  assert.equal(conflict.status, 409);
  assert.match(await conflict.text(), /This folder already exists/);
  const log = context.mock.method(console, "error", () => {});
  const response = await writeFile(request("file.txt", "data"), {
    async put() {
      throw new Error("private bucket details");
    },
    async head() {
      return null;
    },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("private bucket"), false);
  assert.equal(log.mock.callCount(), 1);
});
