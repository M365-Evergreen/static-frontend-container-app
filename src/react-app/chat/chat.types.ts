import type { RunningEvent } from '../sse.ts';

export interface StoredMessage {
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
  request_id: string;
}

export interface HistoryResponse {
  session_id: string;
  messages: StoredMessage[];
}

export type RunStatus = 'starting' | 'running' | 'cancelling' | 'cancelled' | 'failed';

export interface Draft {
  requestId: string;
  prompt: string;
  status: RunStatus;
  progress: RunningEvent[];
  error?: string;
}

export interface CompletedTrace {
  requestId: string;
  progress: RunningEvent[];
}

export const PROMPT_LIMIT = 8000;

export function promptError(prompt: string): string | undefined {
  return Array.from(prompt.trim()).length > PROMPT_LIMIT
    ? `Keep your message within ${PROMPT_LIMIT.toLocaleString()} characters.`
    : undefined;
}

export function isBusy(draft: Draft | null): boolean {
  return draft !== null && ['starting', 'running', 'cancelling'].includes(draft.status);
}
