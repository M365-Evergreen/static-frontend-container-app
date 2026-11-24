import {
  Archive,
  File,
  FileAudio,
  FileImage,
  Files,
  FileSpreadsheet,
  FileText,
  Presentation,
} from "lucide-react";

export const fileTypes = [
  { id: "all", label: "All files", icon: Files },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "spreadsheets", label: "Spreadsheets", icon: FileSpreadsheet },
  { id: "presentations", label: "Presentations", icon: Presentation },
  { id: "pdf", label: "PDFs", icon: FileText },
  { id: "images", label: "Images", icon: FileImage },
  { id: "media", label: "Media", icon: FileAudio },
  { id: "archives", label: "Archives", icon: Archive },
  { id: "other", label: "Other", icon: File },
] as const;

export type FileType = (typeof fileTypes)[number]["id"];

const extensions: Record<
  Exclude<FileType, "all" | "other">,
  readonly string[]
> = {
  documents: ["doc", "docx", "odt", "rtf", "txt", "md", "markdown"],
  spreadsheets: ["xls", "xlsx", "xlsm", "ods", "csv", "tsv"],
  presentations: ["ppt", "pptx", "odp"],
  pdf: ["pdf"],
  images: [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "avif",
    "bmp",
    "tif",
    "tiff",
    "heic",
  ],
  media: [
    "mp3",
    "wav",
    "ogg",
    "m4a",
    "flac",
    "mp4",
    "webm",
    "mov",
    "avi",
    "mkv",
  ],
  archives: ["zip", "tar", "gz", "bz2", "xz", "7z", "rar"],
};

export function fileName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1) || key;
}

export function fileType(key: string): (typeof fileTypes)[number] {
  const name = fileName(key);
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const type = fileTypes.find(
    ({ id }) =>
      id !== "all" && id !== "other" && extensions[id].includes(extension),
  );
  const other = fileTypes.find(({ id }) => id === "other");
  if (!other) throw new Error("The default file type is unavailable.");
  return type ?? other;
}

const sizeFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
export const uploadedFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
});

export function fileSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${sizeFormat.format(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${sizeFormat.format(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
  return `${bytes} B`;
}
