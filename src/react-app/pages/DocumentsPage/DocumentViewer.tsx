import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import {
  Button,
  Dialog,
  Heading,
  Link,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import {
  Download,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  X,
} from "lucide-react";
import type { FileSummary } from "../../../shared/files";
import { fileDownloadUrl } from "../../components/FileGrid/files.api";
import { loadDocumentPreview, type ViewableDocument } from "./document-preview";
import { fileName, fileSize } from "./documents";
import styles from "./DocumentViewer.module.css";

const PreviewContent = lazy(() => import("./DocumentPreviewContent"));
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; document: ViewableDocument };

function Loading() {
  return (
    <p className={styles.message} role="status">
      <LoaderCircle size={18} aria-hidden="true" />
      Loading document preview...
    </p>
  );
}

class PreviewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    console.error("Document preview rendering failed.");
  }

  render() {
    return this.state.failed ? (
      <p role="alert" className={styles.warning}>
        The preview could not be displayed. Download the original or reload the
        page.
      </p>
    ) : (
      this.props.children
    );
  }
}

export function DocumentViewer({
  file,
  onClose,
}: {
  file: FileSummary;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const description = useId();
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void loadDocumentPreview(file, controller.signal)
      .then((document) => {
        if (controller.signal.aborted) return;
        if (document.kind === "text" || document.kind === "unsupported") {
          setState({ status: "ready", document });
        } else {
          objectUrl = URL.createObjectURL(document.blob);
          setState({
            status: "ready",
            document: { ...document, url: objectUrl },
          });
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message:
              reason instanceof Error
                ? reason.message
                : "This document could not be loaded. Try again.",
          });
        }
      });
    return () => {
      controller.abort();
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [file, retry]);

  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog} aria-describedby={description}>
          <header className={styles.header}>
            <div className={styles.identity}>
              <Heading slot="title">{fileName(file.key)}</Heading>
              <p id={description} className={styles.description}>
                {file.key} | {fileSize(file.size)}
              </p>
              <span className={styles.readOnly}>
                <LockKeyhole size={14} aria-hidden="true" />
                Read-only
              </span>
            </div>
            <div className={styles.actions}>
              <Link
                className={styles.button}
                href={fileDownloadUrl(file.key)}
                download={fileName(file.key)}
              >
                <Download size={17} aria-hidden="true" />
                Download original
              </Link>
              <Button
                className={styles.button}
                onPress={onClose}
                aria-label="Close document preview"
                autoFocus
              >
                <X size={20} aria-hidden="true" />
              </Button>
            </div>
          </header>
          <div className={styles.content}>
            {state.status === "loading" && <Loading />}
            {state.status === "error" && (
              <div className={styles.error}>
                <p role="alert">{state.message}</p>
                <Button
                  className={styles.button}
                  onPress={() => {
                    setState({ status: "loading" });
                    setRetry((value) => value + 1);
                  }}
                >
                  <RefreshCw size={17} aria-hidden="true" />
                  Retry preview
                </Button>
              </div>
            )}
            {state.status === "ready" && (
              <PreviewBoundary>
                <Suspense fallback={<Loading />}>
                  <PreviewContent document={state.document} />
                </Suspense>
              </PreviewBoundary>
            )}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
