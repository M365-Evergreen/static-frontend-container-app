import { Markdown } from '../Markdown/Markdown';
import type { ChatMessageProps } from './ChatMessage.types';
import styles from './ChatMessage.module.css';

export function ChatMessage({ role, content, turnId, children }: ChatMessageProps) {
  return (
    <article
      className={`${styles.message} ${role === 'user' ? styles.user : styles.assistant}`}
      aria-label={role === 'user' ? 'Your message' : 'Agent reply'}
      data-turn-id={turnId}
    >
      {role === 'user'
        ? <p className={styles.bubble}>{content}</p>
        : <div className={styles.reply}>{children}{content && <Markdown>{content}</Markdown>}</div>}
    </article>
  );
}
