/**
 * fileIndex.ts
 *
 * R2 -> D1 file index for the `paulibaby-agent` Worker.
 *
 * Implements two ingestion strategies that complement each other:
 *
 *   1. WRITE-THROUGH  — call `indexUploadedObject()` from the upload handler.
 *                       Deterministic, runs in the same request as the upload.
 *
 *   2. RECONCILE      — call `reconcileBucket()` from a Cron Trigger. Walks
 *                       `R2.list()` and upserts anything missing or whose etag
 *                       changed. Catches uploads made via the dashboard,
 *                       `wrangler r2 object put`, or presigned URLs, which
 *                       strategy 1 never sees.
 *
 * Both paths converge on `drainPending()`, which extracts text, chunks it, and
 * writes `file_chunks` (the FTS5 index is kept in sync by triggers).
 *
 * Schema this module expects (already applied to the database):
 *   files(id, bucket, key, etag, size, content_type, uploaded_at, source,
 *         status, error, text_chars, indexed_at, created_at, updated_at)
 *   file_chunks(file_id, chunk_index, content)
 *   file_chunks_fts(content)  -- FTS5, external content
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileIndexEnv {
  R2: R2Bucket;
  DB: D1Database;
  /** Optional: only needed for document extraction. Text/code files work without it. */
  AI?: unknown;
}

export type FileStatus = "pending" | "indexed" | "skipped" | "failed";
export type FileSource = "worker" | "dashboard" | "wrangler" | "presigned" | "backfill";

export interface FileRow {
  id: string;
  bucket: string;
  key: string;
  etag: string;
  size: number;
  content_type: string | null;
  uploaded_at: string | null;
  source: FileSource;
  status: FileStatus;
  error: string | null;
  text_chars: number;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndexResult {
  key: string;
  status: FileStatus;
  chunks: number;
  textChars: number;
  error?: string;
}

export interface ReconcileResult {
  listed: number;
  changed: number;
  unchanged: number;
  pages: number;
}

export interface DrainResult {
  processed: number;
  indexed: number;
  skipped: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const BUCKET = "paulibaby-agent";

/** Target characters per chunk. Keeps rows far below D1's ~2 MB row limit. */
const CHUNK_SIZE = 1000;
/** Characters of overlap between adjacent chunks, so context isn't cut mid-thought. */
const CHUNK_OVERLAP = 150;
/** Objects larger than this are marked `skipped` rather than pulled into memory. */
const MAX_EXTRACT_BYTES = 5 * 1024 * 1024;
/** R2.list() hard cap per call. */
const LIST_PAGE = 1000;
/** Statements per D1 batch. */
const DB_BATCH_SIZE = 50;
/** Parallel extractions during a drain. Keep low — Workers AI calls are the bottleneck. */
const DRAIN_CONCURRENCY = 4;

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

// ---------------------------------------------------------------------------
// 1. Write-through
// ---------------------------------------------------------------------------

/**
 * Index a single object that was just written to R2.
 *
 * Call this immediately after `env.R2.put(...)`:
 *
 *   await env.R2.put(key, body);
 *   const result = await indexUploadedObject(env, key, { source: "worker" });
 *
 * If you don't want the upload request to wait for extraction, use
 * `indexUploadedObjectAsync()` with `ctx.waitUntil()` instead.
 */
export async function indexUploadedObject(
  env: FileIndexEnv,
  key: string,
  opts: { source?: FileSource; extract?: boolean } = {},
): Promise<IndexResult> {
  const { source = "worker", extract = true } = opts;

  const head = await env.R2.head(key);
  if (!head) {
    return { key, status: "failed", chunks: 0, textChars: 0, error: "object not found in R2" };
  }

  await upsertFileRecord(env, head, source);

  if (!extract) {
    return { key, status: "pending", chunks: 0, textChars: 0 };
  }

  const row = await getFile(env, key);
  if (!row) {
    return { key, status: "failed", chunks: 0, textChars: 0, error: "row missing after upsert" };
  }

  return processFile(env, row);
}

/**
 * Fire-and-forget variant for upload handlers that shouldn't block on extraction.
 *
 *   ctx.waitUntil(indexUploadedObjectAsync(env, key, ctx));
 */
export function indexUploadedObjectAsync(
  env: FileIndexEnv,
  key: string,
  ctx: ExecutionContext,
  opts: { source?: FileSource; extract?: boolean } = {},
): void {
  ctx.waitUntil(
    indexUploadedObject(env, key, opts).catch((err) => {
      console.error("fileIndex: async index failed", key, err);
    }),
  );
}

// ---------------------------------------------------------------------------
// 2. Reconcile
// ---------------------------------------------------------------------------

/**
 * Walk the whole bucket and queue anything new or changed.
 *
 * Safe to run repeatedly: the upsert only resets a row to `pending` when the
 * etag actually differs, so a no-op pass writes nothing.
 *
 *   export default {
 *     async scheduled(_event, env, ctx) {
 *       ctx.waitUntil(reconcileBucket(env).then(r => drainPending(env)));
 *     }
 *   }
 */
export async function reconcileBucket(
  env: FileIndexEnv,
  opts: { prefix?: string; maxPages?: number } = {},
): Promise<ReconcileResult> {
  const { prefix, maxPages = Infinity } = opts;

  let cursor: string | undefined;
  let listed = 0;
  let changed = 0;
  let unchanged = 0;
  let pages = 0;

  do {
    const page = await env.R2.list({ cursor, limit: LIST_PAGE, prefix });
    pages++;

    if (page.objects.length) {
      const stmts = page.objects.map((obj) => upsertStatement(env, obj, "backfill"));
      const results = await runBatched(env, stmts);

      for (const res of results) {
        // D1 reports rows_written per statement; 0 means the etag guard skipped it.
        if ((res.meta?.changes ?? 0) > 0) changed++;
        else unchanged++;
      }
      listed += page.objects.length;
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && pages < maxPages);

  return { listed, changed, unchanged, pages };
}

// ---------------------------------------------------------------------------
// 3. Drain the pending queue
// ---------------------------------------------------------------------------

/**
 * Extract + chunk every row currently in `pending`.
 *
 * Run after `reconcileBucket()`, or on its own from a cron to retry failures
 * that were flipped back to `pending`.
 */
export async function drainPending(
  env: FileIndexEnv,
  opts: { limit?: number; concurrency?: number } = {},
): Promise<DrainResult> {
  const { limit = 50, concurrency = DRAIN_CONCURRENCY } = opts;

  const { results } = await env.DB.prepare(
    `SELECT * FROM files WHERE status = 'pending' ORDER BY created_at LIMIT ?`,
  )
    .bind(limit)
    .all<FileRow>();

  const out: DrainResult = { processed: 0, indexed: 0, skipped: 0, failed: 0 };
  const queue = [...(results ?? [])];

  async function worker() {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      out.processed++;
      try {
        const res = await processFile(env, row);
        if (res.status === "indexed") out.indexed++;
        else if (res.status === "skipped") out.skipped++;
        else out.failed++;
      } catch (err) {
        out.failed++;
        await markStatus(env, row.id, "failed", String(err));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// 4. Extraction + chunking
// ---------------------------------------------------------------------------

async function processFile(env: FileIndexEnv, row: FileRow): Promise<IndexResult> {
  if (row.size > MAX_EXTRACT_BYTES) {
    await markStatus(env, row.id, "skipped", `object exceeds ${MAX_EXTRACT_BYTES} bytes`);
    return { key: row.key, status: "skipped", chunks: 0, textChars: 0 };
  }

  const obj = await env.R2.get(row.key);
  if (!obj) {
    await markStatus(env, row.id, "failed", "object no longer exists in R2");
    return { key: row.key, status: "failed", chunks: 0, textChars: 0, error: "missing" };
  }

  let text: string | null;
  try {
    text = await extractText(env, row.key, obj, row.content_type);
  } catch (err) {
    await markStatus(env, row.id, "failed", `extraction failed: ${String(err)}`);
    return { key: row.key, status: "failed", chunks: 0, textChars: 0, error: String(err) };
  }

  if (text === null) {
    await markStatus(env, row.id, "skipped", "unsupported content type");
    return { key: row.key, status: "skipped", chunks: 0, textChars: 0 };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    await markStatus(env, row.id, "skipped", "no extractable text");
    return { key: row.key, status: "skipped", chunks: 0, textChars: 0 };
  }

  // Replace any previous chunks, then insert the new set — one transaction.
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM file_chunks WHERE file_id = ?`).bind(row.id),
  ];
  chunks.forEach((content, i) => {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO file_chunks (file_id, chunk_index, content) VALUES (?, ?, ?)`,
      ).bind(row.id, i, content),
    );
  });
  await runBatched(env, stmts);

  await env.DB.prepare(
    `UPDATE files
        SET status = 'indexed', error = NULL, text_chars = ?,
            indexed_at = ${NOW}, updated_at = ${NOW}
      WHERE id = ?`,
  )
    .bind(text.length, row.id)
    .run();

  return { key: row.key, status: "indexed", chunks: chunks.length, textChars: text.length };
}

/** Content types we can read straight out of R2 as UTF-8 text. */
const TEXT_LIKE =
  /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|typescript|x-sh|x-python|x-httpd-php|toml|sql|graphql|ld\+json))/i;

/** Extensions that are text even when the content type is generic. */
const TEXT_EXT =
  /\.(ps1|psm1|psd1|py|pyi|js|mjs|cjs|ts|tsx|jsx|json|jsonc|md|mdx|txt|log|yaml|yml|toml|ini|cfg|conf|sh|bash|zsh|sql|csv|tsv|html|htm|css|scss|env|gitignore|dockerfile|tf|hcl|rs|go|java|rb|php|c|h|cpp|hpp|cs|swift|kt|xml)$/i;

async function extractText(
  env: FileIndexEnv,
  key: string,
  obj: R2ObjectBody,
  contentType: string | null,
): Promise<string | null> {
  const ct = contentType ?? obj.httpMetadata?.contentType ?? "";

  if (TEXT_LIKE.test(ct) || TEXT_EXT.test(key)) {
    return await obj.text();
  }

  // Everything else goes through Workers AI markdown conversion
  // (PDF, DOCX, HTML, images, ...).
  const ai = env.AI as MarkdownConverter | undefined;
  if (!ai || typeof ai.toMarkdown !== "function") {
    return null;
  }

  const result = await ai.toMarkdown({
    name: key.split("/").pop() || key,
    blob: new Blob([await obj.arrayBuffer()], { type: ct || "application/octet-stream" }),
  });

  const single = Array.isArray(result) ? result[0] : result;
  if (!single || single.format === "error" || typeof single.data !== "string") {
    throw new Error(single?.error ?? "markdown conversion returned no data");
  }
  return single.data;
}

/**
 * Split text into overlapping chunks, preferring paragraph > line > space
 * boundaries so chunks stay semantically coherent.
 */
export function chunkText(
  text: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    if (end < clean.length) {
      const window = clean.slice(start, end);
      const floor = size * 0.5;
      const para = window.lastIndexOf("\n\n");
      const line = window.lastIndexOf("\n");
      const space = window.lastIndexOf(" ");
      const cut = para > floor ? para : line > floor ? line : space > floor ? space : -1;
      if (cut > 0) end = start + cut;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// 5. Queries
// ---------------------------------------------------------------------------

/** Full-text search across indexed chunk content. */
export async function searchFiles(
  env: FileIndexEnv,
  query: string,
  opts: { limit?: number } = {},
): Promise<Array<{ key: string; size: number; snippet: string; chunk_index: number }>> {
  const { limit = 20 } = opts;
  const { results } = await env.DB.prepare(
    `SELECT f.key, f.size, c.chunk_index,
            snippet(file_chunks_fts, 0, '[', ']', '…', 12) AS snippet
       FROM file_chunks_fts
       JOIN file_chunks c ON c.rowid = file_chunks_fts.rowid
       JOIN files f       ON f.id = c.file_id
      WHERE file_chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?`,
  )
    .bind(query, limit)
    .all<{ key: string; size: number; snippet: string; chunk_index: number }>();

  return results ?? [];
}

export async function getFile(env: FileIndexEnv, key: string): Promise<FileRow | null> {
  return await env.DB.prepare(`SELECT * FROM files WHERE bucket = ? AND key = ?`)
    .bind(BUCKET, key)
    .first<FileRow>();
}

export async function listFiles(
  env: FileIndexEnv,
  opts: { status?: FileStatus; prefix?: string; limit?: number; offset?: number } = {},
): Promise<FileRow[]> {
  const { status, prefix, limit = 50, offset = 0 } = opts;
  const where: string[] = ["bucket = ?"];
  const params: unknown[] = [BUCKET];

  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (prefix) {
    where.push("key LIKE ?");
    params.push(`${prefix}%`);
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM files WHERE ${where.join(" AND ")}
      ORDER BY key LIMIT ? OFFSET ?`,
  )
    .bind(...params, limit, offset)
    .all<FileRow>();

  return results ?? [];
}

/** Remove an object from the index (call after `env.R2.delete(key)`). */
export async function removeFromIndex(env: FileIndexEnv, key: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM files WHERE bucket = ? AND key = ?`).bind(BUCKET, key).run();
}

export async function indexStats(
  env: FileIndexEnv,
): Promise<Record<FileStatus, number> & { chunks: number }> {
  const { results } = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM files WHERE bucket = ? GROUP BY status`,
  )
    .bind(BUCKET)
    .all<{ status: FileStatus; n: number }>();

  const stats = { pending: 0, indexed: 0, skipped: 0, failed: 0, chunks: 0 } as Record<
    FileStatus,
    number
  > & { chunks: number };

  for (const r of results ?? []) stats[r.status] = r.n;

  const chunkRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM file_chunks`).first<{
    n: number;
  }>();
  stats.chunks = chunkRow?.n ?? 0;

  return stats;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function upsertStatement(
  env: FileIndexEnv,
  obj: R2Object,
  source: FileSource,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO files (id, bucket, key, etag, size, content_type, uploaded_at, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(bucket, key) DO UPDATE SET
       etag         = excluded.etag,
       size         = excluded.size,
       content_type = COALESCE(excluded.content_type, files.content_type),
       uploaded_at  = excluded.uploaded_at,
       source       = excluded.source,
       status       = 'pending',
       error        = NULL,
       indexed_at   = NULL,
       updated_at   = ${NOW}
     WHERE files.etag <> excluded.etag`,
  ).bind(
    crypto.randomUUID(),
    BUCKET,
    obj.key,
    obj.etag,
    obj.size,
    obj.httpMetadata?.contentType ?? null,
    obj.uploaded instanceof Date ? obj.uploaded.toISOString() : null,
    source,
  );
}

async function upsertFileRecord(
  env: FileIndexEnv,
  obj: R2Object,
  source: FileSource,
): Promise<void> {
  await upsertStatement(env, obj, source).run();
}

async function markStatus(
  env: FileIndexEnv,
  id: string,
  status: FileStatus,
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE files SET status = ?, error = ?, updated_at = ${NOW} WHERE id = ?`,
  )
    .bind(status, error, id)
    .run();
}

/** Run statements in bounded batches so we never blow the D1 batch size. */
async function runBatched(
  env: FileIndexEnv,
  stmts: D1PreparedStatement[],
): Promise<D1Result[]> {
  const out: D1Result[] = [];
  for (let i = 0; i < stmts.length; i += DB_BATCH_SIZE) {
    const slice = stmts.slice(i, i + DB_BATCH_SIZE);
    const res = await env.DB.batch(slice);
    out.push(...res);
  }
  return out;
}

/**
 * Minimal structural type for the Workers AI markdown converter, so this module
 * compiles regardless of which @cloudflare/workers-types version is installed.
 */
interface MarkdownConverter {
  toMarkdown(
    doc: { name: string; blob: Blob },
    opts?: { conversionOptions?: Record<string, unknown> },
  ): Promise<
    | { format: "markdown" | "text" | "error"; data?: string; error?: string; tokens?: number }
    | Array<{ format: "markdown" | "text" | "error"; data?: string; error?: string; tokens?: number }>
  >;
}
