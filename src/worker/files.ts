import {
  filesPageSize,
  type FilesPageResponse,
  type FilesResponse,
} from "../shared/files.ts";
import { errorResponse } from "./session.ts";
import { SessionError } from "./session-store.ts";

interface FileBucket {
  list(options: { limit: number; cursor?: string }): Promise<{
    objects: { key: string; size: number; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

interface DownloadBucket {
  get(key: string): Promise<{
    body: ReadableStream;
    size: number;
    httpEtag: string;
    writeHttpMetadata(headers: Headers): void;
  } | null>;
}

function methodNotAllowed(message: string): Response {
  const response = errorResponse(
    new SessionError("method_not_allowed", message, 405),
  );
  response.headers.set("Allow", "GET");
  return response;
}

export async function listFiles(
  request: Request,
  bucket: FileBucket,
): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed("Use GET to list files.");
  }

  const url = new URL(request.url);
  const limitValue = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");
  const limit = limitValue === null ? 5 : Number(limitValue);
  if (
    limitValue !== null &&
    (!/^[1-9]\d*$/.test(limitValue) ||
      !Number.isSafeInteger(limit) ||
      limit > filesPageSize)
  ) {
    return errorResponse(
      new SessionError(
        "invalid_limit",
        `File limit must be a whole number from 1 to ${filesPageSize}.`,
        400,
      ),
    );
  }
  if (cursor === "") {
    return errorResponse(
      new SessionError(
        "invalid_cursor",
        "Use a non-empty pagination cursor.",
        400,
      ),
    );
  }

  let listing: Awaited<ReturnType<FileBucket["list"]>>;
  let nextCursor: string | null = null;
  try {
    listing = await bucket.list({
      limit,
      ...(cursor === null ? {} : { cursor }),
    });
    if (listing.truncated) {
      if (!listing.cursor || listing.cursor === cursor) {
        throw new Error("R2 did not provide an advancing pagination cursor.");
      }
      nextCursor = listing.cursor;
    }
  } catch {
    console.error("R2 file listing failed.");
    return errorResponse(
      new SessionError(
        "storage_unavailable",
        "Files could not be loaded. Try again.",
        503,
      ),
    );
  }

  const result: FilesResponse = {
    files: listing.objects.map(({ key, size, uploaded }) => ({
      key,
      size,
      uploaded: uploaded.toISOString(),
    })),
  };
  const paginated = limitValue !== null || cursor !== null;
  return Response.json(
    paginated
      ? ({
          ...result,
          nextCursor,
        } satisfies FilesPageResponse)
      : result,
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function downloadFile(
  request: Request,
  bucket: DownloadBucket,
): Promise<Response> {
  if (request.method !== "GET")
    return methodNotAllowed("Use GET to download files.");
  const key = new URL(request.url).searchParams.get("key");
  if (!key || new TextEncoder().encode(key).length > 1024) {
    return errorResponse(
      new SessionError(
        "invalid_file_key",
        "Specify a valid bucket file key.",
        400,
      ),
    );
  }

  let object: Awaited<ReturnType<DownloadBucket["get"]>>;
  try {
    object = await bucket.get(key);
  } catch {
    console.error("R2 file download failed.");
    return errorResponse(
      new SessionError(
        "storage_unavailable",
        "The file could not be downloaded. Try again.",
        503,
      ),
    );
  }
  if (!object) {
    return errorResponse(
      new SessionError(
        "file_not_found",
        "This file is no longer available.",
        404,
      ),
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const filename = key.slice(key.lastIndexOf("/") + 1) || key;
  const encodedName = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  headers.set(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodedName}`,
  );
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/octet-stream");
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}
