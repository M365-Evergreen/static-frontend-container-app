import { useEffect, useState } from "react";
import { Outlet, unstable_useBlocker as useBlocker } from "react-router-dom";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { PublisherContext } from "./publisherContext";
import type { PublicationDraft } from "./publisherContext";
import styles from "../BrowserTools.module.css";

const publisherPath = "/browser-tools/publication-designer";

export default function PublisherWorkspace() {
  const [draft, setDraft] = useState<PublicationDraft | null>(null);
  const blocker = useBlocker(({ nextLocation }) =>
    Boolean(
      draft?.modified &&
      nextLocation.pathname !== publisherPath &&
      !nextLocation.pathname.startsWith(`${publisherPath}/`),
    ),
  );
  useEffect(() => {
    if (!draft?.modified) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft?.modified]);
  return (
    <PublisherContext
      value={{
        draft,
        startTemplate: (template) =>
          setDraft({
            templateId: template.id,
            settings: structuredClone(template.settings),
            content: structuredClone(template.content),
            modified: false,
          }),
        updateContent: (content) =>
          setDraft((current) => {
            if (!current)
              throw new Error("Choose a publication template first.");
            return { ...current, content, modified: true };
          }),
        updateSettings: (settings) =>
          setDraft((current) => {
            if (!current)
              throw new Error("Choose a publication template first.");
            return {
              ...current,
              settings: { ...current.settings, ...settings },
              modified: true,
            };
          }),
      }}
    >
      <Outlet />
      <ModalOverlay
        isOpen={blocker.state === "blocked"}
        className={styles.modalOverlay}
      >
        <Modal className={styles.modal}>
          <Dialog aria-labelledby="leave-publication-title">
            <Heading id="leave-publication-title" slot="title">
              Leave Publisher?
            </Heading>
            <p>
              Your draft is only in this tab. Download it before leaving or it
              will be discarded.
            </p>
            <div className={styles.actions}>
              <Button
                autoFocus
                onPress={() => {
                  if (blocker.state === "blocked") blocker.reset();
                }}
              >
                Continue editing
              </Button>
              <Button
                onPress={() => {
                  if (blocker.state === "blocked") blocker.proceed();
                }}
              >
                Discard and leave
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </PublisherContext>
  );
}
