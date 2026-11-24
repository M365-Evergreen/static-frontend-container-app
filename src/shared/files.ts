export interface FileSummary {
  key: string;
  size: number;
  uploaded: string;
}

export interface FilesResponse {
  files: FileSummary[];
}
