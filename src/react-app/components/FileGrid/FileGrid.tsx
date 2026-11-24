import { useEffect, useId, useState } from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import { Button } from 'react-aria-components/Button';
import { GridList, GridListItem, Text } from 'react-aria-components/GridList';
import type { FileSummary } from '../../../shared/files';
import { loadFiles } from './files.api';
import styles from './FileGrid.module.css';

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

export function FileGrid({ onSelect }: { onSelect?: (id: string) => void }) {
  const headingId = useId();
  const [state, setState] = useState<FileState>({ status: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void loadFiles(controller.signal).then((files) => {
      if (!controller.signal.aborted) setState({ status: 'ready', files });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Files could not be loaded.' });
      }
    });
    return () => controller.abort();
  }, [reload]);

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}><FolderOpen size={20} aria-hidden="true" />Files</h2>
      {state.status === 'loading' && <p role="status" className={styles.message}>Loading files...</p>}
      {state.status === 'error' && (
        <div className={styles.error}>
          <p role="alert">{state.message}</p>
          <Button className={styles.retry} onPress={() => {
            setState({ status: 'loading' });
            setReload((value) => value + 1);
          }}>Retry files</Button>
        </div>
      )}
      {state.status === 'ready' && (
        <GridList
          aria-labelledby={headingId}
          items={state.files}
          layout="grid"
          selectionMode="none"
          className={styles.grid}
          renderEmptyState={() => <p className={styles.message}>No files are available in this bucket.</p>}
        >
          {(file) => (
            <GridListItem id={file.key} textValue={file.key} className={styles.card} onClick={() => onSelect?.(file.key)}>
              <FileText size={28} strokeWidth={1.5} aria-hidden="true" />
              <Text className={styles.name}>{file.key}</Text>
              <Text slot="description" className={styles.metadata}>
                <span>{formatSize(file.size)}</span>
                <time dateTime={file.uploaded}>{dateFormat.format(new Date(file.uploaded))}</time>
              </Text>
              <Button className={styles.download} onPress={() => {
                // Implement download logic here
              }}>Download</Button>
            </GridListItem>
          )}
        </GridList>
      )}
    </section>
  );
}
