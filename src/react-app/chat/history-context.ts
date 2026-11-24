import { createContext } from 'react';
import type { ConversationSummary } from './chat.types';

export interface ChatHistoryState {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => void;
}

export const ChatHistoryContext = createContext<ChatHistoryState | null>(null);
