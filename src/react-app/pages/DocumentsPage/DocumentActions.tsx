import { useEffect, useId, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  FileTrigger,
  Form,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextArea,
  TextField,
} from "react-aria-components";
import { FilePlus2, FolderPlus, FolderUp, Plus, Upload, X } from "lucide-react";
import { fileKeyError } from "../../../shared/files";
import {
  FileConflictError,
  saveBucketEntry,
} from "../../components/FileGrid/files.api";
import styles from "./DocumentsPage.module.css";

type Entry = { key: string; content: Blob | null };
type Choice = "replace" | "skip";

function entryKey(destination: string, name: string, folder = false): string {
  const prefix = destination.endsWith("/")
    ? destination
    : destination
      ? `${destination}/`
      : "";
  const key = `${prefix}${name}${folder && !name.endsWith("/") ? "/" : ""}`;
  const error = fileKeyError(key, folder);
  if (error) throw new Error(error);
  return key;
}

export function DocumentActions({
  folder,
  onChanged,
}: {
  folder: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"choose" | "file" | "folder">("choose");
  const [destination, setDestination] = useState(folder);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const decide = useRef<((choice: Choice) => void) | null>(null);
  const conflictDescription = useId();

  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );

  function confirmReplacement(
    key: string,
    message: string,
    signal: AbortSignal,
  ): Promise<Choice> {
    signal.throwIfAborted();
    setConflict({ key, message });
    return new Promise<Choice>((resolve, reject) => {
      const abort = () => {
        decide.current = null;
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      decide.current = (choice) => {
        signal.removeEventListener("abort", abort);
        decide.current = null;
        resolve(choice);
      };
    });
  }

  async function run(entries: Entry[]) {
    if (controller.current || !entries.length) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError("");
    setNotice("");
    let saved = 0;
    let skipped = 0;
    try {
      for (const [index, entry] of entries.entries()) {
        active.signal.throwIfAborted();
        setProgress(`Saving ${index + 1} of ${entries.length}: ${entry.key}`);
        let etag: string | undefined;
        while (true) {
          try {
            await saveBucketEntry(
              entry.key,
              entry.content,
              active.signal,
              etag,
            );
            saved++;
            break;
          } catch (reason) {
            if (!(reason instanceof FileConflictError)) throw reason;
            const choice = await confirmReplacement(
              entry.key,
              reason.message,
              active.signal,
            );
            setConflict(null);
            if (choice === "skip") {
              skipped++;
              break;
            }
            etag = reason.etag;
          }
        }
      }
      active.signal.throwIfAborted();
      setNotice(
        `Saved ${saved} ${saved === 1 ? "item" : "items"}${skipped ? `; kept ${skipped} existing ${skipped === 1 ? "file" : "files"}` : ""}.`,
      );
      if (!skipped) {
        setName("");
        setContent("");
        setMode("choose");
        setOpen(false);
      }
    } catch (reason) {
      if (controller.current !== active) return;
      setError(
        active.signal.aborted
          ? `Upload cancelled. ${saved} items saved. An in-flight file may already have reached the bucket; refresh before retrying.`
          : `${saved} of ${entries.length} items saved. ${reason instanceof Error ? reason.message : "The operation failed. Try again."}`,
      );
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setBusy(false);
        setProgress("");
        setConflict(null);
        // Even a cancelled or failed response may follow a completed bucket write.
        onChanged();
      }
    }
  }

  function upload(files: FileList | null, directory: boolean) {
    if (!files?.length) return;
    try {
      const entries = Array.from(files, (file) => {
        if (directory && !file.webkitRelativePath) {
          throw new Error(
            "Your browser did not provide folder paths. Use Upload files and set a destination folder instead.",
          );
        }
        return {
          key: entryKey(
            destination,
            directory ? file.webkitRelativePath : file.name,
          ),
          content: file,
        };
      });
      if (new Set(entries.map(({ key }) => key)).size !== entries.length) {
        throw new Error(
          "The selection contains duplicate paths. Choose files with unique names.",
        );
      }
      void run(entries);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The selection could not be uploaded.",
      );
    }
  }

  return (
    <div className={styles.createActions}>
      <DialogTrigger
        isOpen={open}
        onOpenChange={(value) => {
          if (busy) return;
          if (value) {
            setDestination(folder);
            setError("");
            setNotice("");
          }
          setOpen(value);
        }}
      >
        <Button className={styles.createButton}>
          <Plus size={18} aria-hidden="true" />
          Create or upload
        </Button>
        <ModalOverlay
          className={styles.modalOverlay}
          isDismissable={!busy}
          isKeyboardDismissDisabled={busy}
        >
          <Modal className={styles.modal}>
            <Dialog
              className={styles.dialog}
              role={conflict ? "alertdialog" : "dialog"}
              aria-describedby={conflict ? conflictDescription : undefined}
            >
              <div className={styles.dialogHeader}>
                <Heading slot="title">
                  {conflict ? "Replace existing file?" : "Create or upload"}
                </Heading>
                <Button
                  className={styles.iconButton}
                  slot="close"
                  isDisabled={busy}
                  aria-label="Close create or upload"
                >
                  <X size={20} aria-hidden="true" />
                </Button>
              </div>
              {conflict ? (
                <div className={styles.form}>
                  <div className={styles.form} id={conflictDescription}>
                    <p>{conflict.message}</p>
                    <p className={styles.conflictPath}>{conflict.key}</p>
                    <p>
                      Replacing this file overwrites its content. This cannot be
                      undone.
                    </p>
                  </div>
                  <div className={styles.actionButtons}>
                    <Button
                      className={styles.refresh}
                      autoFocus
                      onPress={() => decide.current?.("skip")}
                    >
                      Keep existing file
                    </Button>
                    <Button
                      className={styles.createButton}
                      onPress={() => decide.current?.("replace")}
                    >
                      Replace file
                    </Button>
                    <Button
                      className={styles.refresh}
                      onPress={() => controller.current?.abort()}
                    >
                      Cancel upload
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <TextField
                    className={styles.field}
                    value={destination}
                    onChange={setDestination}
                    isDisabled={busy}
                  >
                    <Label>Destination folder</Label>
                    <Input placeholder="Leave empty for the bucket root" />
                  </TextField>
                  {mode === "choose" ? (
                    <>
                      <div className={styles.actionChoices}>
                        <Button
                          className={styles.choice}
                          isDisabled={busy}
                          onPress={() => {
                            setMode("file");
                            setError("");
                          }}
                        >
                          <FilePlus2 aria-hidden="true" />
                          Create file
                          <span>Write a text, Markdown, JSON or CSV file.</span>
                        </Button>
                        <Button
                          className={styles.choice}
                          isDisabled={busy}
                          onPress={() => {
                            setMode("folder");
                            setError("");
                          }}
                        >
                          <FolderPlus aria-hidden="true" />
                          Create folder<span>Add a folder to the bucket.</span>
                        </Button>
                        <FileTrigger
                          allowsMultiple
                          onSelect={(files) => upload(files, false)}
                        >
                          <Button className={styles.choice} isDisabled={busy}>
                            <Upload aria-hidden="true" />
                            Upload files
                            <span>
                              Choose one or more files from your device.
                            </span>
                          </Button>
                        </FileTrigger>
                        <FileTrigger
                          acceptDirectory
                          allowsMultiple
                          onSelect={(files) => upload(files, true)}
                        >
                          <Button className={styles.choice} isDisabled={busy}>
                            <FolderUp aria-hidden="true" />
                            Upload folder
                            <span>
                              Keep the folder&apos;s relative file paths.
                            </span>
                          </Button>
                        </FileTrigger>
                      </div>
                      <p className={styles.secondary}>
                        Files are sent to the Worker&apos;s bucket. Browser and
                        Worker upload limits apply. Folder uploads include files
                        and their paths, not empty directories.
                      </p>
                    </>
                  ) : (
                    <Form
                      className={styles.form}
                      onSubmit={(event) => {
                        event.preventDefault();
                        try {
                          const key = entryKey(
                            destination,
                            name,
                            mode === "folder",
                          );
                          const types: Record<string, string> = {
                            txt: "text/plain",
                            md: "text/markdown",
                            markdown: "text/markdown",
                            json: "application/json",
                            csv: "text/csv",
                          };
                          const extension = name
                            .slice(name.lastIndexOf(".") + 1)
                            .toLowerCase();
                          void run([
                            {
                              key,
                              content:
                                mode === "folder"
                                  ? null
                                  : new Blob([content], {
                                      type: `${types[extension] ?? "text/plain"};charset=utf-8`,
                                    }),
                            },
                          ]);
                        } catch (reason) {
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : "Enter a valid file or folder name.",
                          );
                        }
                      }}
                    >
                      <TextField
                        className={styles.field}
                        value={name}
                        onChange={setName}
                        isRequired
                        isDisabled={busy}
                      >
                        <Label>
                          {mode === "folder" ? "Folder name" : "File name"}
                        </Label>
                        <Input
                          autoFocus
                          placeholder={
                            mode === "folder" ? "reports" : "notes.md"
                          }
                        />
                      </TextField>
                      {mode === "file" && (
                        <TextField
                          className={styles.field}
                          value={content}
                          onChange={setContent}
                          isDisabled={busy}
                        >
                          <Label>File content</Label>
                          <TextArea
                            className={styles.contentEditor}
                            spellCheck={false}
                          />
                        </TextField>
                      )}
                      <div className={styles.actionButtons}>
                        <Button
                          className={styles.refresh}
                          isDisabled={busy}
                          onPress={() => setMode("choose")}
                        >
                          Back
                        </Button>
                        <Button
                          className={styles.createButton}
                          type="submit"
                          isDisabled={busy}
                        >
                          {mode === "folder" ? "Create folder" : "Save file"}
                        </Button>
                      </div>
                    </Form>
                  )}
                  {busy && (
                    <div className={styles.form}>
                      <p role="status" className={styles.conflictPath}>
                        {progress}
                      </p>
                      <Button
                        className={styles.refresh}
                        onPress={() => controller.current?.abort()}
                      >
                        Cancel upload
                      </Button>
                    </div>
                  )}
                </>
              )}
              {error && (
                <p className={styles.writeError} role="alert">
                  {error}
                </p>
              )}
              {notice && <p role="status">{notice}</p>}
            </Dialog>
          </Modal>
        </ModalOverlay>
      </DialogTrigger>
      {!open && notice && (
        <p role="status" className={styles.results}>
          {notice}
        </p>
      )}
    </div>
  );
}
