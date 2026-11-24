import {
  fileKeyError,
  filesPageSize,
  type FileSummary,
} from "../../../shared/files.ts";
import { readApiError } from "../../chat/chat.api.ts";

function fileSummary(value: unknown): value is FileSummary {
  if (typeof value !== "object" || value === null) return false;
  return (
    "key" in value &&
    typeof value.key === "string" &&
    value.key.length > 0 &&
    "size" in value &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    "uploaded" in value &&
    typeof value.uploaded === "string" &&
    Number.isFinite(Date.parse(value.uploaded))
  );
}

function parseFiles(payload: unknown, limit: number): FileSummary[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("files" in payload) ||
    !Array.isArray(payload.files) ||
    payload.files.length > limit ||
    !payload.files.every(fileSummary) ||
    new Set(payload.files.map((file) => file.key)).size !== payload.files.length
  ) {
    throw new Error("The server returned an invalid file list.");
  }
  return payload.files;
}

export async function loadFiles(signal: AbortSignal): Promise<FileSummary[]> {
  const response = await fetch("/api/files", { signal, cache: "no-store" });
  if (!response.ok) throw new Error(await readApiError(response));
  return parseFiles(await response.json(), 5).filter(
    (file) => !file.key.endsWith("/"),
  );
}

export async function loadAllFiles(
  signal: AbortSignal,
): Promise<FileSummary[]> {
  const files: FileSummary[] = [];
  const keys = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    signal.throwIfAborted();
    const params = new URLSearchParams({ limit: String(filesPageSize) });
    if (cursor !== null) params.set("cursor", cursor);
    const response = await fetch(`/api/files?${params}`, {
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const payload: unknown = await response.json();
    const page = parseFiles(payload, filesPageSize);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("nextCursor" in payload) ||
      (payload.nextCursor !== null &&
        (typeof payload.nextCursor !== "string" || !payload.nextCursor))
    ) {
      throw new Error("The server returned invalid file pagination.");
    }
    const nextCursor = payload.nextCursor;
    if (nextCursor !== null && cursors.has(nextCursor)) {
      throw new Error("The server returned a repeated file pagination cursor.");
    }
    if (nextCursor !== null) cursors.add(nextCursor);
    for (const file of page) {
      if (keys.has(file.key))
        throw new Error("The server returned duplicate files across pages.");
      keys.add(file.key);
      files.push(file);
    }
    cursor = nextCursor;
  } while (cursor !== null);
  signal.throwIfAborted();
  return files;
}

export function fileDownloadUrl(key: string): string {
  return `/api/files/download?${new URLSearchParams({ key })}`;
}

export class FileConflictError extends Error {
  constructor(
    message: string,
    readonly etag: string,
  ) {
    super(message);
    this.name = "FileConflictError";
  }
}

export async function saveBucketEntry(
  key: string,
  content: Blob | null,
  signal: AbortSignal,
  etag?: string,
): Promise<FileSummary> {
  const folder = content === null;
  const invalidKey = fileKeyError(key, folder);
  if (invalidKey) throw new Error(invalidKey);
  const response = await fetch(
    `/api/files/${folder ? "folder" : "upload"}?${new URLSearchParams({ key })}`,
    {
      method: folder ? "POST" : "PUT",
      headers: {
        ...(!folder
          ? { "Content-Type": content.type || "application/octet-stream" }
          : {}),
        ...(etag ? { "If-Match": etag } : {}),
      },
      ...(content === null ? {} : { body: content }),
      signal,
      cache: "no-store",
    },
  );
  if (response.status === 409 && !folder) {
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error &&
      typeof payload.error.message === "string" &&
      "etag" in payload.error &&
      typeof payload.error.etag === "string"
    ) {
      throw new FileConflictError(payload.error.message, payload.error.etag);
    }
    throw new Error(
      "The file changed during this operation. Review the bucket and try again.",
    );
  }
  if (!response.ok) throw new Error(await readApiError(response));
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("file" in payload) ||
    !fileSummary(payload.file) ||
    payload.file.key !== key
  ) {
    throw new Error(
      "The server returned an invalid saved file. Refresh the bucket before retrying.",
    );
  }
  return payload.file;
}
