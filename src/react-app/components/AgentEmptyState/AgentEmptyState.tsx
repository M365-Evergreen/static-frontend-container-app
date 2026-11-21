import { MessageCircleDashed } from 'lucide-react';
import styles from './AgentEmptyState.module.css';

export function AgentEmptyState() {
  return (
    <div className={styles.empty}>
      <MessageCircleDashed size={32} aria-hidden="true" />
      <h2>What should we work on?</h2>
      <p>Ask a question or share an idea. The planner, researcher, and synthesizer will work through it.</p>
      <p className={styles.note}>The researcher searches the configured knowledge source when enabled. The agents cannot browse the web, read your files, or run commands.</p>
    </div>
  );
}
