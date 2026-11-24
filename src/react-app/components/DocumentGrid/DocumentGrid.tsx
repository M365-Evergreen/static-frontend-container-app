import React from 'react';
import {} from 'lucide-react'
import {loadFiles} from './files.api.ts';
import type { FileSummary } from '../../../shared/files.ts';
import styles from './DocumentGrid.module.css';

type FileState =
  | { status: 'loading' }
  | { status: 'ready'; files: FileSummary[] }
  | { status: 'error'; message: string };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${sizeFormat.format(size / (1024 * 1024))} MB`;
  if (size >= 1024) return `${sizeFormat.format(size / 1024)} KB`;
  return `${sizeFormat.format(size)} B`;
}
export interface BaseDocument {
  id: string;
  title: string;
  fileType?: string;
  updatedAt?: string;
  thumbnailUrl?: string;
}

export interface DocumentGridProps<T extends BaseDocument> {
  documents: T[];
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  onOpen?: (doc: T) => void;
  renderThumbnail?: (doc: T) => React.ReactNode;
  emptyMessage?: string;
  minColumnWidth?: number;
}

export function DocumentGrid<T extends BaseDocument>({
  documents,
  selectedIds = [],
  onSelect,
  onOpen,
  renderThumbnail,
  emptyMessage = 'No documents found.',
  minColumnWidth = 220,
}: DocumentGridProps<T>) {
  if (documents.length === 0) {
    return <div className={styles.emptyState}>{emptyMessage}</div>;
  }

  return (
    <div
      className={styles.grid}
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`,
      }}
      role="list"
    >
      {documents.map((doc) => {
        const isSelected = selectedIds.includes(doc.id);

        return (
          <div
            key={doc.id}
            role="listitem"
            tabIndex={0}
            className={`${styles.card} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelect?.(doc.id)}
            onDoubleClick={() => onOpen?.(doc)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen?.(doc);
              if (e.key === ' ') {
                e.preventDefault();
                onSelect?.(doc.id);
              }
            }}
          >
            <div className={styles.preview}>
              {renderThumbnail ? (
                renderThumbnail(doc)
              ) : doc.thumbnailUrl ? (
                <img
                  src={doc.thumbnailUrl}
                  alt={doc.title}
                  className={styles.thumbnailImg}
                  loading="lazy"
                />
              ) : (
                <span className={styles.badge}>
                  {doc.fileType?.toUpperCase() || 'DOC'}
                </span>
              )}
            </div>

            <div className={styles.meta}>
              <h3 className={styles.title} title={doc.title}>
                {doc.title}
              </h3>
              {doc.updatedAt && (
                <p className={styles.subtitle}>Updated {doc.updatedAt}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
