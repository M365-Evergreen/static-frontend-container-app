import type { FileSummary } from '../../../shared/files.ts';
import { readApiError } from '../../chat/chat.api.ts';

function fileSummary(value: unknown): value is FileSummary {
  if (typeof value !== 'object' || value === null) return false;
  return 'key' in value && typeof value.key === 'string' && value.key.length > 0 &&
    'size' in value && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0 &&
    'uploaded' in value && typeof value.uploaded === 'string' && Number.isFinite(Date.parse(value.uploaded));
}

export async function loadFiles(signal: AbortSignal): Promise<FileSummary[]> {
  const response = await fetch('/api/files', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(await readApiError(response));
  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null || !('files' in payload) ||
      !Array.isArray(payload.files) || payload.files.length > 5 || !payload.files.every(fileSummary) ||
      new Set(payload.files.map((file) => file.key)).size !== payload.files.length) {
    throw new Error('The server returned an invalid file list.');
  }
  return payload.files;
}
