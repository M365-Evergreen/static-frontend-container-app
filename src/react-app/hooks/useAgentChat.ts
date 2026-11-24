import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteConversation, loadHistory, restoreSession } from '../chat/chat.api.ts';
import { isBusy, promptError } from '../chat/chat.types.ts';
import type { CompletedTrace, Draft, StoredMessage } from '../chat/chat.types.ts';
import { readSse } from '../sse.ts';
import type { ApiRequest } from '../auth/auth-context.ts';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The conversation request failed.';
}

export function useAgentChat(options: {
  sessionId?: string;
  ownerId: string;
  request: ApiRequest;
  onHistoryChanged?: () => void;
}) {
  const { request, onHistoryChanged } = options;
  const [{ sessionId, notice }] = useState(() => restoreSession(options.ownerId, options.sessionId));
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [traces, setTraces] = useState<CompletedTrace[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [actionError, setActionError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const active = useRef<{ requestId: string; controller: AbortController } | null>(null);
  const locked = useRef(false);
  const historyReady = useRef(false);

  const controllerFor = useCallback(() => {
    const controller = new AbortController();
    controllers.current.add(controller);
    return controller;
  }, []);

  const refreshHistory = useCallback(async (epoch: number, controller: AbortController) => {
    const history = await loadHistory(sessionId, controller.signal, request);
    if (generation.current !== epoch || controller.signal.aborted) return null;
    setMessages(history.messages);
    setDraft((previous) => previous && history.messages.some((message) => message.request_id === previous.requestId)
      ? null : previous);
    onHistoryChanged?.();
    return history.messages;
  }, [sessionId, request, onHistoryChanged]);

  const retryHistory = useCallback(async () => {
    if (locked.current || active.current) return;
    locked.current = true;
    historyReady.current = false;
    setLoadingHistory(true);
    setHistoryError('');
    setActionError('');
    const epoch = generation.current;
    const controller = controllerFor();
    try {
      const history = await refreshHistory(epoch, controller);
      if (history) historyReady.current = true;
    } catch (error) {
      if (generation.current === epoch && !controller.signal.aborted) {
        setHistoryError(errorMessage(error));
      }
    } finally {
      controllers.current.delete(controller);
      if (generation.current === epoch) {
        locked.current = false;
        setLoadingHistory(false);
      }
    }
  }, [controllerFor, refreshHistory]);

  useEffect(() => {
    generation.current += 1;
    void retryHistory();
    const ownedControllers = controllers.current;
    return () => {
      generation.current += 1;
      for (const controller of ownedControllers) controller.abort();
      ownedControllers.clear();
      active.current = null;
      locked.current = false;
      historyReady.current = false;
    };
  }, [retryHistory]);

  const submit = async () => {
    const text = prompt.trim();
    if (!text || promptError(text) || !historyReady.current || locked.current || active.current) return;
    const epoch = generation.current;
    const requestId = crypto.randomUUID();
    const controller = controllerFor();
    active.current = { requestId, controller };
    const progress: Draft['progress'] = [];
    setActionError('');
    setPrompt('');
    setDraft({ requestId, prompt: text, status: 'starting', progress });
    const current = () => generation.current === epoch && !controller.signal.aborted;
    let committed = false;

    try {
      const response = await request('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId,
          'x-request-id': requestId,
        },
        cache: 'no-store',
        body: JSON.stringify({ prompt: text, max_turns: 5 }),
        signal: controller.signal,
      });
      await readSse(response, controller.signal, (event) => {
        if (!current()) return;
        if (event.status === 'running') {
          if (event.turn !== progress.length + 1) throw new Error('The server returned out-of-order agent stages.');
          progress.push(event);
          setDraft((previous) => previous?.requestId === requestId
            ? { ...previous, status: previous.status === 'cancelling' ? 'cancelling' : 'running', progress: [...progress] }
            : previous);
        } else if (event.status === 'done') {
          if (event.request_id !== requestId) throw new Error('The server completed a different request.');
          committed = true;
          setMessages((previous) => {
            if (previous.some((message) => message.request_id === requestId)) return previous;
            const sequence = previous[previous.length - 1]?.sequence ?? 0;
            return [...previous,
              { sequence: sequence + 1, role: 'user', content: text, request_id: requestId },
              { sequence: sequence + 2, role: 'assistant', content: event.final_output, request_id: requestId }];
          });
          setTraces((previous) => [...previous, { requestId, progress: [...progress] }]);
          setDraft(null);
          onHistoryChanged?.();
        } else {
          if (event.code === 'history_sync_failed') {
            historyReady.current = false;
            setHistoryError(event.message);
          }
          setDraft((previous) => previous?.requestId === requestId
            ? { ...previous, status: event.code === 'run_cancelled' ? 'cancelled' : 'failed', error: event.message }
            : previous);
        }
      });
    } catch (error) {
      if (current() && !committed) {
        // A lost terminal frame can follow a successful commit; history is authoritative.
        try {
          const history = await refreshHistory(epoch, controller);
          if (history?.some((message) => message.request_id === requestId)) {
            setDraft(null);
            setActionError('The connection ended, but the completed reply was restored from history.');
          } else if (current()) {
            setDraft((previous) => previous?.requestId === requestId
              ? { ...previous, status: 'failed', error: errorMessage(error) }
              : previous);
          }
        } catch (historyFailure) {
          if (current()) {
            historyReady.current = false;
            setHistoryError(`Could not verify the run: ${errorMessage(historyFailure)}`);
            setDraft((previous) => previous?.requestId === requestId
              ? { ...previous, status: 'failed', error: errorMessage(error) }
              : previous);
          }
        }
      }
    } finally {
      controllers.current.delete(controller);
      if (active.current?.controller === controller) active.current = null;
    }
  };

  const cancel = async () => {
    const run = active.current;
    if (!run || locked.current) return;
    locked.current = true;
    const epoch = generation.current;
    const controller = controllerFor();
    const current = () => generation.current === epoch && !controller.signal.aborted;
    setCancelling(true);
    setActionError('');
    setDraft((previous) => previous?.requestId === run.requestId ? { ...previous, status: 'cancelling' } : previous);
    let confirmed = false;
    let cancellationFailure = '';
    try {
      try {
        await deleteConversation(sessionId, controller.signal, run.requestId, request);
        confirmed = true;
        run.controller.abort();
      } catch (error) {
        cancellationFailure = errorMessage(error);
      }
      if (!current()) return;
      const history = await refreshHistory(epoch, controller);
      if (!current() || !history) return;
      const completed = history.some((message) => message.request_id === run.requestId);
      if (completed) {
        setDraft(null);
        setActionError('The reply completed before cancellation. It remains in your history.');
      } else if (confirmed) {
        setDraft((previous) => previous?.requestId === run.requestId
          ? { ...previous, status: 'cancelled', error: 'Run cancelled. No completed exchange was stored.' }
          : previous);
      } else {
        setActionError(`Cancellation was not confirmed: ${cancellationFailure}`);
        setDraft((previous) => previous?.requestId === run.requestId && previous.status === 'cancelling'
          ? { ...previous, status: 'running' }
          : previous);
      }
    } catch (error) {
      if (current()) {
        historyReady.current = false;
        setHistoryError(`Could not verify conversation history: ${errorMessage(error)}`);
        setActionError(confirmed
          ? 'Cancellation was requested, but its stored history could not be verified.'
          : `Cancellation was not confirmed: ${cancellationFailure}`);
        setDraft((previous) => previous?.requestId === run.requestId
          ? { ...previous, status: confirmed ? 'cancelled' : previous.status === 'cancelling' ? 'running' : previous.status,
            error: 'Run outcome could not be verified. Reload history before sending.' }
          : previous);
      }
    } finally {
      controllers.current.delete(controller);
      if (generation.current === epoch) {
        locked.current = false;
        setCancelling(false);
      }
    }
  };

  const reset = async () => {
    if (locked.current || active.current) return;
    locked.current = true;
    const epoch = generation.current;
    const controller = controllerFor();
    setResetting(true);
    setActionError('');
    try {
      await deleteConversation(sessionId, controller.signal, undefined, request);
      if (generation.current !== epoch || controller.signal.aborted) return;
      setMessages([]);
      setTraces([]);
      setDraft(null);
      setPrompt('');
      setHistoryError('');
      historyReady.current = true;
      onHistoryChanged?.();
    } catch (error) {
      if (generation.current === epoch && !controller.signal.aborted) {
        setActionError(`Conversation was not reset: ${errorMessage(error)}`);
        historyReady.current = false;
        setHistoryError('Conversation reset was not confirmed. Reload history before sending.');
      }
    } finally {
      controllers.current.delete(controller);
      if (generation.current === epoch) {
        locked.current = false;
        setResetting(false);
      }
    }
  };

  return {
    messages, traces, draft, prompt, setPrompt, loadingHistory, historyError, actionError, notice,
    resetting, cancelling, busy: isBusy(draft) || cancelling, submit, cancel, reset, retryHistory,
  };
}
