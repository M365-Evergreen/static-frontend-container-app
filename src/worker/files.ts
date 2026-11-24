import type { FilesResponse } from "../shared/files.ts";
import { errorResponse } from "./session.ts";
import { SessionError } from "./session-store.ts";

interface FileBucket {
  list(options: { limit: number }): Promise<{
    objects: { key: string; size: number; uploaded: Date }[];
  }>;
}

export async function listFiles(request: Request, bucket: FileBucket): Promise<Response> {
  if (request.method !== "GET") {
    const response = errorResponse(new SessionError("method_not_allowed", "Use GET to list files.", 405));
    response.headers.set("Allow", "GET");
    return response;
  }

  let listing: Awaited<ReturnType<FileBucket["list"]>>;
  try {
    listing = await bucket.list({ limit: 5 });
  } catch {
    console.error("R2 file listing failed.");
    return errorResponse(new SessionError("storage_unavailable", "Files could not be loaded. Try again.", 503));
  }

  return Response.json({
    files: listing.objects.map(({ key, size, uploaded }) => ({
      key,
      size,
      uploaded: uploaded.toISOString(),
    })),
  } satisfies FilesResponse, { headers: { "Cache-Control": "no-store" } });
}
