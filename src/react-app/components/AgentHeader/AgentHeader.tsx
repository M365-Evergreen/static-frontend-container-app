import { RotateCw } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
import type { AgentHeaderProps } from './AgentHeader.types';
import styles from './AgentHeader.module.css';

export function AgentHeader({ disabled, resetting, onReset }: AgentHeaderProps) {
  return (
    <header className={styles.header}>
      <div>
        <h1 id="agent-heading">New Thread</h1>
        <p>Plan, analyse, and refine ideas with three sequential agents.</p>
      </div>
      <IconButton
        aria-label="Reset conversation"
        tooltip="Reset conversation"
        isDisabled={disabled}
        onPress={() => void onReset()}
      >
        <RotateCw size={18} aria-hidden="true" />
      </IconButton>
      {resetting && <span className="sr-only">Resetting conversation</span>}
    </header>
  );
}
