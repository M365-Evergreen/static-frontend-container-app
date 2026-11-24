import type { CodeBlockProps } from './CodeBlock.types';
import styles from './CodeBlock.module.css';

export function CodeBlock({ children }: CodeBlockProps) {
  return <pre className={styles.code} tabIndex={0} aria-label="Code block">{children}</pre>;
}
