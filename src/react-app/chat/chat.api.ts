import type { ConversationPage, ConversationSummary, HistoryResponse, StoredMessage } from './chat.types.ts';
import type { ApiRequest } from '../auth/auth-context.ts';

const SESSION_KEY = 'paulibaby-agent.session-id';
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

export function restoreSession(ownerId: string, selectedId?: string): { sessionId: string; notice: string } {
  const key = `${SESSION_KEY}.${ownerId}`;
  const sessionId = selectedId ?? crypto.randomUUID();
  try {
    const stored = localStorage.getItem(key);
    if (!selectedId && stored && UUID.test(stored)) return { sessionId: stored, notice: '' };
    localStorage.setItem(key, sessionId);
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

export async function loadHistory(sessionId: string, signal: AbortSignal, request: ApiRequest = fetch): Promise<HistoryResponse> {
  const response = await request('/api/history', {
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
  request: ApiRequest = fetch,
): Promise<void> {
  const headers: Record<string, string> = { 'x-session-id': sessionId };
  if (requestId) headers['x-request-id'] = requestId;
  const response = await request(requestId ? '/api/chat' : '/api/history', {
    method: 'DELETE',
    headers,
    cache: 'no-store',
    signal,
  });
  if (response.status !== 204) {
    throw new Error(response.ok ? 'The server did not confirm the operation.' : await readApiError(response));
  }
}

function conversation(value: unknown): value is ConversationSummary {
  return record(value) && typeof value.session_id === 'string' && UUID.test(value.session_id) &&
    typeof value.title === 'string' &&
    typeof value.created_at === 'number' && Number.isSafeInteger(value.created_at) &&
    typeof value.updated_at === 'number' && Number.isSafeInteger(value.updated_at) &&
    value.updated_at >= 0 && value.updated_at <= 8640000000000000 &&
    typeof value.message_count === 'number' && Number.isSafeInteger(value.message_count) && value.message_count > 0;
}

export async function listConversations(
  signal: AbortSignal,
  request: ApiRequest,
  cursor: string | null,
): Promise<ConversationPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await request(`/api/conversations${query}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(await readApiError(response));
  const value: unknown = await response.json();
  if (!record(value) || !Array.isArray(value.conversations) ||
    !value.conversations.every(conversation) || (value.cursor !== null && typeof value.cursor !== 'string')) {
    throw new Error('The server returned invalid conversation summaries.');
  }
  return { conversations: value.conversations, cursor: value.cursor };
}
