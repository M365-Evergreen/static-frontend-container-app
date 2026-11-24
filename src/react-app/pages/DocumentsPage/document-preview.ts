import type { FileSummary } from "../../../shared/files";
import type { Language } from "../../browser-tools/tools/CodeFormatter.logic";
import { fileDownloadUrl } from "../../components/FileGrid/files.api";
import { readApiError } from "../../chat/chat.api";

type TextFormat = {
  kind: "text";
  label: string;
  language: string;
  formatter?: Language;
  parser?: string;
  markdown?: boolean;
  delimiter?: "," | "\t";
};
type AssetFormat = {
  kind: "image" | "pdf" | "audio" | "video";
  label: string;
  mimeType: string;
};
type PreviewFormat = TextFormat | AssetFormat;

export type TextDocument = {
  kind: "text";
  label: string;
  language: string;
  original: string;
  formatted: string | null;
  markdown: boolean;
  rows: string[][] | null;
  warning: string | null;
};
type AssetDocument = AssetFormat & { blob: Blob };
type UnsupportedDocument = { kind: "unsupported"; message: string };
export type LoadedDocument = TextDocument | AssetDocument | UnsupportedDocument;
export type ViewableDocument =
  TextDocument | (AssetDocument & { url: string }) | UnsupportedDocument;

export const textPreviewLimit = 1024 * 1024;
export const assetPreviewLimit = 20 * 1024 * 1024;

function text(
  label: string,
  language = "plain",
  formatter?: Language,
): TextFormat {
  return { kind: "text", label, language, formatter };
}

const textFormats: Record<string, TextFormat> = {
  txt: text("Plain text"),
  log: text("Log"),
  text: text("Plain text"),
  ts: text("TypeScript", "typescript", "typescript"),
  tsx: text("TypeScript JSX", "tsx", "typescript"),
  mts: text("TypeScript", "typescript", "typescript"),
  cts: text("TypeScript", "typescript", "typescript"),
  js: text("JavaScript", "javascript", "javascript"),
  jsx: text("JavaScript JSX", "jsx", "javascript"),
  mjs: text("JavaScript", "javascript", "javascript"),
  cjs: text("JavaScript", "javascript", "javascript"),
  json: { ...text("JSON", "json", "json"), parser: "json-stringify" },
  jsonc: text("JSON with comments", "json", "json"),
  css: text("CSS", "css", "css"),
  scss: text("SCSS", "css"),
  less: text("Less", "css"),
  html: text("HTML source", "markup", "html"),
  htm: text("HTML source", "markup", "html"),
  xml: text("XML source", "markup"),
  svg: text("SVG source", "markup"),
  md: { ...text("Markdown", "markdown"), markdown: true },
  markdown: { ...text("Markdown", "markdown"), markdown: true },
  mdx: text("MDX source", "jsx"),
  csv: { ...text("CSV"), delimiter: "," },
  tsv: { ...text("TSV"), delimiter: "\t" },
  yaml: text("YAML", "yaml"),
  yml: text("YAML", "yaml"),
  toml: text("TOML"),
  ini: text("Configuration"),
  env: text("Environment file"),
  py: text("Python", "python"),
  go: text("Go", "go"),
  rs: text("Rust", "rust"),
  sh: text("Shell", "bash"),
  bash: text("Shell", "bash"),
  sql: text("SQL", "sql"),
  graphql: text("GraphQL", "graphql"),
  java: text("Java", "java"),
  c: text("C", "c"),
  h: text("C header", "c"),
  cpp: text("C++", "cpp"),
  cs: text("C#", "csharp"),
  diff: text("Diff", "diff"),
  patch: text("Patch", "diff"),
};
const assetFormats: Record<string, AssetFormat> = {
  png: { kind: "image", label: "PNG image", mimeType: "image/png" },
  jpg: { kind: "image", label: "JPEG image", mimeType: "image/jpeg" },
  jpeg: { kind: "image", label: "JPEG image", mimeType: "image/jpeg" },
  gif: { kind: "image", label: "GIF image", mimeType: "image/gif" },
  webp: { kind: "image", label: "WebP image", mimeType: "image/webp" },
  avif: { kind: "image", label: "AVIF image", mimeType: "image/avif" },
  bmp: { kind: "image", label: "Bitmap image", mimeType: "image/bmp" },
  pdf: { kind: "pdf", label: "PDF", mimeType: "application/pdf" },
  mp3: { kind: "audio", label: "MP3 audio", mimeType: "audio/mpeg" },
  wav: { kind: "audio", label: "WAV audio", mimeType: "audio/wav" },
  ogg: { kind: "audio", label: "Ogg audio", mimeType: "audio/ogg" },
  mp4: { kind: "video", label: "MP4 video", mimeType: "video/mp4" },
  webm: { kind: "video", label: "WebM video", mimeType: "video/webm" },
};
const formats = new Map<string, PreviewFormat>(
  Object.entries({ ...textFormats, ...assetFormats }),
);

function previewFormat(key: string): PreviewFormat | null {
  const name = key.slice(key.lastIndexOf("/") + 1).toLowerCase();
  const extension = name.slice(name.lastIndexOf(".") + 1);
  if (
    [
      "readme",
      "license",
      "dockerfile",
      "makefile",
      ".gitignore",
      ".dockerignore",
    ].includes(name) ||
    name.startsWith(".env")
  ) {
    return text("Plain text");
  }
  return formats.get(extension) ?? null;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    console.error("Document preview stream could not be cancelled.");
  }
}

async function readBytes(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const message = `This file is too large to preview (limit ${limit / 1024 / 1024} MB). Download the original to view it.`;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The server returned no document content.");
  const abort = () => {
    void cancelReader(reader);
  };
  signal.addEventListener("abort", abort, { once: true });
  let complete = false;
  try {
    signal.throwIfAborted();
    const length = response.headers.get("Content-Length");
    if (length !== null && Number(length) > limit) throw new Error(message);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error(message);
      chunks.push(value);
    }
    complete = true;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", abort);
    if (!complete) await cancelReader(reader);
    reader.releaseLock();
  }
}

function decodeText(bytes: Uint8Array): string {
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? "utf-16le"
      : bytes[0] === 254 && bytes[1] === 255
        ? "utf-16be"
        : "utf-8";
  let content: string;
  try {
    content = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      "This file is not supported UTF-8 or UTF-16 text. Download the original to view it.",
    );
  }
  if (content.includes("\0"))
    throw new Error(
      "This file contains binary data and cannot be previewed as text.",
    );
  return content;
}

export async function loadDocumentPreview(
  file: FileSummary,
  signal: AbortSignal,
): Promise<LoadedDocument> {
  signal.throwIfAborted();
  const format = previewFormat(file.key);
  if (!format)
    return {
      kind: "unsupported",
      message:
        "Preview is not available for this file type. Download the original to open it in a compatible application.",
    };
  const limit = format.kind === "text" ? textPreviewLimit : assetPreviewLimit;
  if (file.size > limit)
    throw new Error(
      `This file is too large to preview (limit ${limit / 1024 / 1024} MB). Download the original to view it.`,
    );
  const response = await fetch(fileDownloadUrl(file.key), {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const bytes = await readBytes(response, limit, signal);
  signal.throwIfAborted();
  if (format.kind !== "text") {
    if (
      format.kind === "pdf" &&
      new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
    ) {
      throw new Error(
        "This file does not contain a valid PDF header. Download the original to inspect it.",
      );
    }
    return { ...format, blob: new Blob([bytes], { type: format.mimeType }) };
  }

  const original = decodeText(bytes);
  let formatted: string | null = null;
  let rows: string[][] | null = null;
  let warning: string | null = null;
  if (original && format.formatter) {
    try {
      const { formatCode } =
        await import("../../browser-tools/tools/CodeFormatter.logic");
      signal.throwIfAborted();
      formatted = await formatCode(original, format.formatter, 2, false, true, {
        filepath: file.key,
        ...(format.parser ? { parser: format.parser } : {}),
      });
    } catch (reason) {
      signal.throwIfAborted();
      warning = `Formatting unavailable; showing the original text. ${reason instanceof Error ? reason.message : "The formatter failed."}`;
    }
  }
  if (original && format.delimiter) {
    try {
      const { parseCsv } =
        await import("../../browser-tools/tools/DataConverter.logic");
      const parsed = parseCsv(original, format.delimiter);
      if (parsed.reduce((count, row) => count + row.length, 0) > 10_000) {
        throw new Error("The table exceeds the 10,000-cell preview limit.");
      }
      rows = parsed;
    } catch (reason) {
      warning = `Table preview unavailable; showing the original text. ${reason instanceof Error ? reason.message : "The table could not be read."}`;
    }
  }
  signal.throwIfAborted();
  return {
    kind: "text",
    label: format.label,
    language: format.language,
    original,
    formatted,
    rows,
    warning,
    markdown: format.markdown ?? false,
  };
}
