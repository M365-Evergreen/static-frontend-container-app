import { filesPageSize, type FileSummary } from "../../../shared/files.ts";
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
  return parseFiles(await response.json(), 5);
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
