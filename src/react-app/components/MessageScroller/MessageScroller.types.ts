import type { ReactNode } from 'react';

export interface MessageScrollerProps {
  children: ReactNode;
  anchorId: string | null;
  busy: boolean;
}
