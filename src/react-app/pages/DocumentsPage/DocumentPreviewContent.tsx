import { Fragment, useState } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { Highlight, themes } from "prism-react-renderer";
import { Markdown } from "../../components/Markdown/Markdown";
import type { TextDocument, ViewableDocument } from "./document-preview";
import styles from "./DocumentViewer.module.css";

function TextPreview({ document }: { document: TextDocument }) {
  const hasPreview = document.markdown || document.rows !== null;
  const [mode, setMode] = useState(
    hasPreview
      ? "preview"
      : document.formatted !== null
        ? "formatted"
        : "original",
  );
  const modes = [
    ...(hasPreview ? [{ id: "preview", label: "Preview" }] : []),
    ...(document.formatted !== null
      ? [{ id: "formatted", label: "Formatted" }]
      : []),
    { id: "original", label: "Original text" },
  ];
  const code =
    mode === "formatted" && document.formatted !== null
      ? document.formatted
      : document.original;
  return (
    <div className={styles.textPreview}>
      <div className={styles.viewOptions}>
        <p>{document.label}</p>
        {modes.length > 1 && (
          <ToggleButtonGroup
            aria-label="Document view"
            className={styles.viewModes}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([mode])}
            onSelectionChange={(keys) => {
              const selected = modes.find(({ id }) => keys.has(id));
              if (selected) setMode(selected.id);
            }}
          >
            {modes.map(({ id, label }) => (
              <ToggleButton id={id} key={id} className={styles.mode}>
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
      </div>
      {document.warning && (
        <p role="alert" className={styles.warning}>
          {document.warning}
        </p>
      )}
      {!document.original ? (
        <p className={styles.message}>This file is empty.</p>
      ) : mode === "preview" && document.markdown ? (
        <div className={styles.prose}>
          <Markdown>{document.original}</Markdown>
        </div>
      ) : mode === "preview" && document.rows !== null ? (
        <div
          className={styles.csv}
          tabIndex={0}
          role="region"
          aria-label="Table document content"
        >
          <table>
            <caption>{document.label} content</caption>
            <tbody>
              {document.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Highlight
          code={code}
          language={document.language}
          theme={themes.vsDark}
        >
          {({ className, style, tokens, getTokenProps }) => (
            <pre
              className={`${styles.code} ${className}`}
              style={style}
              tabIndex={0}
              aria-label="Document content"
            >
              <code>
                {tokens.map((line, index) => (
                  <Fragment key={index}>
                    {line.map((token, position) => (
                      <span key={position} {...getTokenProps({ token })}>
                        {token.empty ? "" : token.content}
                      </span>
                    ))}
                    {index < tokens.length - 1 ? "\n" : ""}
                  </Fragment>
                ))}
              </code>
            </pre>
          )}
        </Highlight>
      )}
      {mode === "formatted" && (
        <p className={styles.message}>
          Formatting affects this read-only preview only. The original file is
          unchanged.
        </p>
      )}
    </div>
  );
}

export default function DocumentPreviewContent({
  document,
}: {
  document: ViewableDocument;
}) {
  const [failed, setFailed] = useState(false);
  if (document.kind === "text") return <TextPreview document={document} />;
  if (document.kind === "unsupported")
    return <p className={styles.message}>{document.message}</p>;
  if (failed)
    return (
      <p role="alert" className={styles.warning}>
        Your browser could not display this {document.label.toLowerCase()}.
        Download the original to view it.
      </p>
    );
  if (document.kind === "image")
    return (
      <img
        className={styles.image}
        src={document.url}
        alt="Document preview"
        onError={() => setFailed(true)}
      />
    );
  if (document.kind === "pdf")
    return (
      <div className={styles.pdf}>
        <p className={styles.message}>
          If your browser cannot display this PDF, use Download original.
        </p>
        <iframe
          src={document.url}
          title="PDF document preview"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </div>
    );
  if (document.kind === "audio")
    return (
      <audio
        className={styles.media}
        src={document.url}
        controls
        preload="metadata"
        aria-label="Audio document preview"
        onError={() => setFailed(true)}
      />
    );
  return (
    <video
      className={styles.media}
      src={document.url}
      controls
      preload="metadata"
      aria-label="Video document preview"
      onError={() => setFailed(true)}
    />
  );
}
