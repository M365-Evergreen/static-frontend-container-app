import type { HistoryResponse, StoredMessage } from './chat.types.ts';

const SESSION_KEY = 'static-frontend-container-app.session-id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function storedMessage(value: unknown): value is StoredMessage {
  return record(value) && Number.isSafeInteger(value.sequence) &&
    typeof value.sequence === 'number' && value.sequence > 0 &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    typeof value.request_id === 'string' && UUID.test(value.request_id);
}

export function restoreSession(): { sessionId: string; notice: string } {
  const sessionId = crypto.randomUUID();
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored && UUID.test(stored)) return { sessionId: stored, notice: '' };
    localStorage.setItem(SESSION_KEY, sessionId);
    return {
      sessionId,
      notice: stored ? 'The saved conversation ID was invalid. A new conversation was created.' : '',
    };
  } catch {
    return {
      sessionId,
      notice: 'Browser storage is unavailable. This conversation cannot be restored after a reload.',
    };
  }
}

export async function readApiError(response: Response): Promise<string> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return `Request failed (${response.status}).`;
  }
  return record(payload) && record(payload.error) && typeof payload.error.message === 'string'
    ? payload.error.message
    : `Request failed (${response.status}).`;
}

export async function loadHistory(sessionId: string, signal: AbortSignal): Promise<HistoryResponse> {
  const response = await fetch('/api/history', {
    headers: { 'x-session-id': sessionId },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const payload: unknown = await response.json();
  if (!record(payload) || payload.session_id !== sessionId ||
      !Array.isArray(payload.messages) || !payload.messages.every(storedMessage)) {
    throw new Error('The server returned invalid conversation history.');
  }
  const messages = payload.messages;
  if (messages.some((message, index) =>
    index > 0 && message.sequence <= (messages[index - 1]?.sequence ?? 0))) {
    throw new Error('The server returned unordered conversation history.');
  }
  return { session_id: sessionId, messages };
}

export async function deleteConversation(
  sessionId: string,
  signal: AbortSignal,
  requestId?: string,
): Promise<void> {
  const headers: Record<string, string> = { 'x-session-id': sessionId };
  if (requestId) headers['x-request-id'] = requestId;
  const response = await fetch(requestId ? '/api/chat' : '/api/history', {
    method: 'DELETE',
    headers,
    cache: 'no-store',
    signal,
  });
  if (response.status !== 204) {
    throw new Error(response.ok ? 'The server did not confirm the operation.' : await readApiError(response));
  }
}
