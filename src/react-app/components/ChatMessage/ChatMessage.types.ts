import type { ReactNode } from 'react';

export interface ChatMessageProps {
  role: 'user' | 'assistant';
  content?: string;
  turnId?: string;
  children?: ReactNode;
}
