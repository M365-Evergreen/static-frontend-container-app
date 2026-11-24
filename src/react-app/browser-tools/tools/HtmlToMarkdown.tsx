import {
  ListBoxItem,
  Button,
  FileTrigger,
  TextField,
  Label,
  TextArea,
} from "react-aria-components";
import { ToolSelect } from "../components/ToolControls";
import { useState } from "react";
import { ToolPanel, OutputActions } from "../components/ToolPanel";
import { useToolOperation } from "../useToolOperation";
import { htmlToMarkdown } from "./HtmlToMarkdown.logic";
import type { MarkdownOptions } from "./HtmlToMarkdown.logic";
import styles from "../BrowserTools.module.css";

const sample =
  "<h1>Browser utilities</h1><p>Your <strong>input</strong> stays in your browser.</p><ul><li>Private</li><li>Local</li></ul><pre><code>const local = true;</code></pre>";

export default function HtmlToMarkdown() {
  const [input, setInput] = useState(sample);
  const [options, setOptions] = useState<MarkdownOptions>({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  const reader = useToolOperation<string>();
  const operation = useToolOperation<string>();
  const source = reader.result ?? input;
  return (
    <ToolPanel
      title="HTML to Markdown"
      description="Convert raw HTML or a local HTML file without rendering or executing it."
      error={reader.error || operation.error}
      busy={reader.busy || operation.busy}
      stats={operation.stats}
    >
      <div className={styles.toolbar}>
        <ToolSelect
          selectedKey={String(options.headingStyle)}
          onSelectionChange={(selectedValue) => {
            setOptions({
              ...options,
              headingStyle: selectedValue === "atx" ? "atx" : "setext",
            });
            operation.clear();
          }}
          label={<>Headings</>}
        >
          <ListBoxItem id={String("atx")}>ATX (#)</ListBoxItem>
          <ListBoxItem id={String("setext")}>Setext (underline)</ListBoxItem>
        </ToolSelect>
        <ToolSelect
          selectedKey={String(options.bulletListMarker)}
          onSelectionChange={(selectedValue) => {
            const marker = selectedValue;
            if (marker === "-" || marker === "*" || marker === "+") {
              setOptions({ ...options, bulletListMarker: marker });
              operation.clear();
            }
          }}
          label={<>Bullet marker</>}
        >
          <ListBoxItem id={String("-")}>-</ListBoxItem>
          <ListBoxItem id={String("*")}>*</ListBoxItem>
          <ListBoxItem id={String("+")}>+</ListBoxItem>
        </ToolSelect>
        <ToolSelect
          selectedKey={String(options.codeBlockStyle)}
          onSelectionChange={(selectedValue) => {
            setOptions({
              ...options,
              codeBlockStyle:
                selectedValue === "fenced" ? "fenced" : "indented",
            });
            operation.clear();
          }}
          label={<>Code blocks</>}
        >
          <ListBoxItem id={String("fenced")}>Fenced</ListBoxItem>
          <ListBoxItem id={String("indented")}>Indented</ListBoxItem>
        </ToolSelect>
        <Button
          onPress={() => {
            reader.clear();
            operation.clear();
            setInput(sample);
          }}
        >
          Sample
        </Button>
        <Button
          isDisabled={reader.busy || operation.busy}
          onPress={() =>
            void operation.run(
              () => htmlToMarkdown(source, options),
              new Blob([source]).size,
              (value) => new Blob([value]).size,
            )
          }
        >
          Convert to Markdown
        </Button>
      </div>
      <div>
        <FileTrigger
          acceptedFileTypes={".html,.htm,text/html".split(",")}
          onSelect={(files) => {
            const file = files?.[0];
            operation.clear();
            if (!file) return;
            if (!/\.html?$/i.test(file.name)) {
              reader.fail("Select an .html or .htm file.");
              return;
            }
            void reader.run(
              () => file.text(),
              file.size,
              (value) => new Blob([value]).size,
            );
          }}
        >
          <Button>
            <>Local HTML file</>
          </Button>
        </FileTrigger>
      </div>
      <div className={styles.grid}>
        <div className={styles.pane}>
          <TextField
            value={source}
            onChange={(selectedValue) => {
              setInput(selectedValue);
              reader.clear();
              operation.clear();
            }}
          >
            <Label>
              <>HTML source</>
            </Label>
            <TextArea spellCheck={false} />
          </TextField>
          <Button
            onPress={() => {
              setInput("");
              reader.clear();
              operation.clear();
            }}
          >
            Clear input
          </Button>
        </div>
        <div className={styles.pane}>
          <TextField isReadOnly value={operation.result ?? ""}>
            <Label>
              <>Markdown output</>
            </Label>
            <TextArea spellCheck={false} />
          </TextField>
          <OutputActions
            key={operation.result}
            text={operation.result ?? ""}
            filename="document.md"
            mime="text/markdown"
            disabled={operation.result === null}
          />
        </div>
      </div>
    </ToolPanel>
  );
}
