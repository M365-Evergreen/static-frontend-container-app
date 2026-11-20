import type { Draft, RunStatus } from '../../chat/chat.types';

export interface AgentTraceProps {
  progress: Draft['progress'];
  status?: RunStatus | 'done';
}
