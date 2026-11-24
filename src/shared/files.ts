export interface FileSummary {
  key: string;
  size: number;
  uploaded: string;
}

export interface FilesResponse {
  files: FileSummary[];
}

export interface FilesPageResponse extends FilesResponse {
  nextCursor: string | null;
}

export const filesPageSize = 100;

export function fileKeyError(key: string, folder = false): string | null {
  const path = folder && key.endsWith("/") ? key.slice(0, -1) : key;
  if (!path || new TextEncoder().encode(key).length > 1024) {
    return "Enter a path between 1 and 1,024 UTF-8 bytes.";
  }
  if (
    /[\p{Cc}\\]/u.test(key) ||
    path
      .split("/")
      .some((part) => !part.trim() || part === "." || part === "..")
  ) {
    return "Use non-empty path segments; backslashes, control characters and dot-only navigation segments are not allowed.";
  }
  if (folder && !key.endsWith("/"))
    return "Folder paths must end with a slash.";
  return null;
}
