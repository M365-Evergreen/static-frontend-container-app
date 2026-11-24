import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '../CodeBlock/CodeBlock';
import type { MarkdownProps } from './Markdown.types';
import styles from './Markdown.module.css';

export function Markdown({ children }: MarkdownProps) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => <div className={styles.table} tabIndex={0} aria-label="Table"><table>{children}</table></div>,
          img: ({ alt }) => <span>Image unavailable{alt ? `: ${alt}` : ''}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
