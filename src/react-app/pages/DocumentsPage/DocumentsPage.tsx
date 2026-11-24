import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Cell,
  Column,
  Input,
  Label,
  Link,
  Row,
  SearchField,
  Table,
  TableBody,
  TableHeader,
  ToggleButton,
  ToggleButtonGroup,
  type SortDescriptor,
  type Key,
} from "react-aria-components";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clock3,
  Download,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
  Folder,
  Eye,
} from "lucide-react";
import type { FileSummary } from "../../../shared/files";
import {
  fileDownloadUrl,
  loadAllFiles,
} from "../../components/FileGrid/files.api";
import {
  fileName,
  fileSize,
  fileType,
  fileTypes,
  uploadedFormat,
  type FileType,
  bucketFolders,
  bucketFolderTree,
  folderPaths,
} from "./documents";
import { DocumentActions } from "./DocumentActions";
import { FolderBreadcrumbs } from "./FolderBreadcrumbs";
import { FolderTree } from "./FolderTree";
import { DocumentViewer } from "./DocumentViewer";
import styles from "./DocumentsPage.module.css";

type FileState =
  | { status: "loading" }
  | { status: "ready"; files: FileSummary[] }
  | { status: "error"; message: string };

function FileIcon({ file }: { file: FileSummary }) {
  const type = fileType(file.key);
  const Icon = type.icon;
  return (
    <span className={`${styles.fileIcon} ${styles[type.id]}`}>
      <Icon size={22} aria-hidden="true" />
    </span>
  );
}

function SortIcon({ column, sort }: { column: string; sort: SortDescriptor }) {
  const Icon =
    sort.column !== column
      ? ArrowUpDown
      : sort.direction === "descending"
        ? ArrowDown
        : ArrowUp;
  return <Icon size={14} aria-hidden="true" />;
}

export function DocumentsPage() {
  const [state, setState] = useState<FileState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [previewFile, setPreviewFile] = useState<FileSummary | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<Key>>(new Set());
  const [selectedType, setSelectedType] = useState<FileType>("all");
  const [sort, setSort] = useState<SortDescriptor>({
    column: "uploaded",
    direction: "descending",
  });

  useEffect(() => {
    const controller = new AbortController();
    void loadAllFiles(controller.signal)
      .then((files) => {
        if (!controller.signal.aborted) setState({ status: "ready", files });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Files could not be loaded. Try again.",
          });
        }
      });
    return () => controller.abort();
  }, [reload]);

  function refresh() {
    setState({ status: "loading" });
    setReload((value) => value + 1);
  }

  function navigateFolder(path: string) {
    if (path === folder) return;
    setFolder(path);
    setQuery("");
    setExpandedFolders(
      (current) => new Set([...current, ...folderPaths(path).slice(0, -1)]),
    );
  }

  const tree = useMemo(
    () => bucketFolderTree(state.status === "ready" ? state.files : []),
    [state],
  );
  const entries = state.status === "ready" ? state.files : [];
  const files = entries.filter((file) => !file.key.endsWith("/"));
  const folders = bucketFolders(entries, folder);
  const folderFiles = files.filter((file) => file.key.startsWith(folder));
  const search = query.trim().toLowerCase();
  const filtered = folderFiles.filter(
    (file) =>
      file.key.toLowerCase().includes(search) &&
      (selectedType === "all" || fileType(file.key).id === selectedType),
  );
  const sorted = [...filtered].sort((a, b) => {
    const comparison =
      sort.column === "name"
        ? fileName(a.key).localeCompare(fileName(b.key), "en-GB")
        : sort.column === "size"
          ? a.size - b.size
          : Date.parse(a.uploaded) - Date.parse(b.uploaded);
    const direction = sort.direction === "descending" ? -1 : 1;
    return comparison * direction || a.key.localeCompare(b.key, "en-GB");
  });
  const latest = [...folderFiles]
    .sort(
      (a, b) =>
        Date.parse(b.uploaded) - Date.parse(a.uploaded) ||
        a.key.localeCompare(b.key, "en-GB"),
    )
    .slice(0, 2);

  return (
    <section
      className={styles.documentsPage}
      aria-labelledby="documents-title"
      aria-busy={state.status === "loading"}
    >
      <header className={styles.header}>
        <div>
          <h1 id="documents-title">
            <FolderOpen size={28} aria-hidden="true" />
            Files
          </h1>
          <p>Browse and download files from the Worker&apos;s bucket.</p>
        </div>
        <div className={styles.actionButtons}>
          <DocumentActions folder={folder} onChanged={refresh} />
          <Button
            className={styles.refresh}
            isDisabled={state.status === "loading"}
            onPress={refresh}
          >
            <RefreshCw size={18} aria-hidden="true" />
            Refresh files
          </Button>
        </div>
      </header>

      <FolderBreadcrumbs folder={folder} onNavigate={navigateFolder} />

      {state.status === "loading" && (
        <p className={styles.message} role="status">
          <LoaderCircle
            className={styles.spinner}
            size={20}
            aria-hidden="true"
          />
          Loading files from the bucket...
        </p>
      )}
      {state.status === "error" && (
        <div className={styles.error}>
          <p role="alert">{state.message}</p>
          <Button className={styles.refresh} onPress={refresh}>
            Retry files
          </Button>
        </div>
      )}

      {state.status === "ready" && (
        <div className={styles.browserLayout}>
          <FolderTree
            folders={tree}
            folder={folder}
            expandedKeys={expandedFolders}
            onExpandedChange={setExpandedFolders}
            onNavigate={navigateFolder}
          />
          <div className={styles.folderContent}>
            {folders.length > 0 && (
              <section aria-label="Folders" className={styles.folderGrid}>
                {folders.map((path) => (
                  <Button
                    className={styles.folderButton}
                    key={path}
                    onPress={() => navigateFolder(path)}
                  >
                    <Folder size={22} aria-hidden="true" />
                    {path.slice(folder.length, -1)}
                  </Button>
                ))}
              </section>
            )}
            {!search && selectedType === "all" && latest.length > 0 && (
              <section aria-labelledby="latest-files-title">
                <h2 id="latest-files-title" className={styles.sectionTitle}>
                  Recently uploaded
                </h2>
                <div className={styles.cards}>
                  {latest.map((file) => (
                    <article className={styles.card} key={file.key}>
                      <div className={styles.cardHeading}>
                        <FileIcon file={file} />
                        <h3 title={file.key}>
                          <Button
                            className={styles.fileName}
                            aria-haspopup="dialog"
                            onPress={() => setPreviewFile(file)}
                          >
                            {fileName(file.key)}
                          </Button>
                        </h3>
                      </div>
                      <div className={styles.cardDetails}>
                        <Clock3 size={20} aria-hidden="true" />
                        <div>
                          <p>
                            Uploaded{" "}
                            <time dateTime={file.uploaded}>
                              {uploadedFormat.format(new Date(file.uploaded))}
                            </time>
                          </p>
                          <p className={styles.secondary}>
                            {fileType(file.key).label} | {fileSize(file.size)}
                          </p>
                        </div>
                      </div>
                      <Link
                        className={styles.download}
                        href={fileDownloadUrl(file.key)}
                        download={fileName(file.key)}
                        aria-label={`Download ${file.key}`}
                      >
                        <Download size={16} aria-hidden="true" />
                        Download
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section
              aria-labelledby="bucket-files-title"
              className={styles.fileList}
            >
              <h2 id="bucket-files-title" className={styles.sectionTitle}>
                All bucket files
              </h2>
              <div className={styles.toolbar}>
                <ToggleButtonGroup
                  className={styles.filters}
                  aria-label="File types"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={new Set([selectedType])}
                  onSelectionChange={(keys) => {
                    const type = fileTypes.find(({ id }) => keys.has(id));
                    if (type) setSelectedType(type.id);
                  }}
                >
                  {fileTypes.map(({ id, label, icon: Icon }) => {
                    const count =
                      id === "all"
                        ? folderFiles.length
                        : folderFiles.filter(
                            (file) => fileType(file.key).id === id,
                          ).length;
                    return (
                      <ToggleButton
                        id={id}
                        key={id}
                        className={styles.filter}
                        aria-label={`${label} (${count})`}
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span>{label}</span>
                        <span className={styles.count}>{count}</span>
                      </ToggleButton>
                    );
                  })}
                </ToggleButtonGroup>
                <SearchField
                  className={styles.search}
                  value={query}
                  onChange={setQuery}
                >
                  <Label className={styles.srOnly}>Search files</Label>
                  <div className={styles.searchInput}>
                    <Search size={18} aria-hidden="true" />
                    <Input placeholder="Search by name or folder" />
                    <Button aria-label="Clear file search">
                      <X size={16} aria-hidden="true" />
                    </Button>
                  </div>
                </SearchField>
              </div>
              <p role="status" className={styles.results}>
                Showing {filtered.length} of {folderFiles.length} files
              </p>
              <div className={styles.tableContainer}>
                <Table
                  aria-label="Bucket files"
                  selectionMode="none"
                  className={styles.table}
                  sortDescriptor={sort}
                  onSortChange={setSort}
                >
                  <TableHeader>
                    <Column id="name" isRowHeader allowsSorting>
                      <span className={styles.sortHeading}>
                        Name
                        <SortIcon column="name" sort={sort} />
                      </span>
                    </Column>
                    <Column id="type">Type</Column>
                    <Column id="size" allowsSorting>
                      <span className={styles.sortHeading}>
                        Size
                        <SortIcon column="size" sort={sort} />
                      </span>
                    </Column>
                    <Column id="uploaded" allowsSorting>
                      <span className={styles.sortHeading}>
                        Uploaded
                        <SortIcon column="uploaded" sort={sort} />
                      </span>
                    </Column>
                    <Column id="actions">Actions</Column>
                  </TableHeader>
                  <TableBody
                    items={sorted}
                    renderEmptyState={() => (
                      <p className={styles.empty}>
                        {folderFiles.length
                          ? "No files match your search or selected file type."
                          : "No files are available in this bucket."}
                      </p>
                    )}
                  >
                    {(file) => (
                      <Row id={file.key} textValue={file.key}>
                        <Cell>
                          <div className={styles.fileIdentity}>
                            <FileIcon file={file} />
                            <div>
                              <Button
                                className={styles.fileName}
                                aria-haspopup="dialog"
                                onPress={() => setPreviewFile(file)}
                              >
                                {fileName(file.key)}
                              </Button>
                              {file.key.includes("/") && (
                                <p className={styles.path}>{file.key}</p>
                              )}
                            </div>
                          </div>
                        </Cell>
                        <Cell>{fileType(file.key).label}</Cell>
                        <Cell>{fileSize(file.size)}</Cell>
                        <Cell>
                          <time dateTime={file.uploaded}>
                            {uploadedFormat.format(new Date(file.uploaded))}
                          </time>
                        </Cell>
                        <Cell>
                          <div className={styles.fileActions}>
                            <Button
                              className={styles.rowDownload}
                              aria-haspopup="dialog"
                              aria-label={`View ${file.key}`}
                              onPress={() => setPreviewFile(file)}
                            >
                              <Eye size={18} aria-hidden="true" />
                              <span>View</span>
                            </Button>
                            <Link
                              className={styles.rowDownload}
                              href={fileDownloadUrl(file.key)}
                              download={fileName(file.key)}
                              aria-label={`Download ${file.key}`}
                            >
                              <Download size={18} aria-hidden="true" />
                              <span>Download</span>
                            </Link>
                          </div>
                        </Cell>
                      </Row>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </div>
        </div>
      )}
      {previewFile && (
        <DocumentViewer
          key={previewFile.key}
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </section>
  );
}

export default DocumentsPage;
