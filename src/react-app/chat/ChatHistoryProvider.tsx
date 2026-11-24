import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-context';
import { listConversations } from './chat.api';
import type { ConversationSummary } from './chat.types';
import { ChatHistoryContext } from './history-context';

interface Catalogue {
  owner: string | null;
  conversations: ConversationSummary[];
  cursor: string | null;
  loading: boolean;
  error: string;
}

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
  const { account, request } = useAuth();
  const owner = account?.id ?? null;
  const [catalogue, setCatalogue] = useState<Catalogue>({
    owner: null, conversations: [], cursor: null, loading: false, error: '',
  });
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    active.current?.abort();
    if (!owner) return;
    const controller = new AbortController();
    active.current = controller;
    setCatalogue((previous) => ({
      owner, conversations: previous.owner === owner ? previous.conversations : [],
      cursor: previous.owner === owner ? previous.cursor : null, loading: true, error: '',
    }));
    try {
      const page = await listConversations(controller.signal, request, cursor);
      if (controller.signal.aborted) return;
      setCatalogue((previous) => ({
        owner,
        conversations: cursor && previous.owner === owner
          ? [...previous.conversations, ...page.conversations.filter((item) =>
            !previous.conversations.some((existing) => existing.session_id === item.session_id))]
          : page.conversations,
        cursor: page.cursor, loading: false, error: '',
      }));
    } catch (failure) {
      if (!controller.signal.aborted) setCatalogue((previous) => ({
        ...previous, loading: false,
        error: failure instanceof Error ? failure.message : 'Conversation history could not be loaded.',
      }));
    }
  }, [owner, request]);

  useEffect(() => {
    if (owner) void load();
    return () => active.current?.abort();
  }, [owner, load]);

  const refresh = useCallback(() => { void load(); }, [load]);
  const visible = catalogue.owner === owner && owner !== null;
  return (
    <ChatHistoryContext.Provider value={{
      conversations: visible ? catalogue.conversations : [],
      loading: visible ? catalogue.loading : Boolean(owner),
      error: visible ? catalogue.error : '',
      hasMore: visible && catalogue.cursor !== null,
      refresh,
      loadMore: () => { if (!catalogue.loading && catalogue.cursor) void load(catalogue.cursor); },
    }}>
      {children}
    </ChatHistoryContext.Provider>
  );
}
