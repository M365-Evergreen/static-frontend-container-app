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
