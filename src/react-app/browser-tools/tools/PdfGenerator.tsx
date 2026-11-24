import {
  ListBoxItem,
  Button,
  TextField,
  Label,
  Input,
  TextArea,
} from "react-aria-components";
import { ToolSelect } from "../components/ToolControls";
import { useState } from "react";
import { ToolPanel, BlobPreview } from "../components/ToolPanel";
import { useToolOperation } from "../useToolOperation";
import { downloadBlob } from "../browserIO";
import { generatePdf } from "./PdfGenerator.logic";
import type { PdfOptions } from "./PdfGenerator.logic";
import styles from "../BrowserTools.module.css";

const sample =
  "1. OVERVIEW\nThese utilities process documents, images and text locally in your browser.\n\n2. PRIVACY\nNo tool input is uploaded to a server.\n\n3. NEXT STEPS\nReview the generated document and download your PDF.";

export default function PdfGenerator() {
  const [options, setOptions] = useState<PdfOptions>({
    title: "Browser Tools Overview",
    author: "Document author",
    content: sample,
    orientation: "p",
    format: "a4",
  });
  const operation = useToolOperation<Blob>();
  function update(next: Partial<PdfOptions>) {
    setOptions({ ...options, ...next });
    operation.clear();
  }
  return (
    <ToolPanel
      title="PDF Generator"
      description="Generate a multi-page plain-text document and preview it on demand."
      {...operation}
    >
      <p className={styles.note}>
        The built-in font supports basic Latin (ASCII) text, not arbitrary
        Unicode or rich documents. If your browser cannot display a PDF,
        download it instead.
      </p>
      <div className={styles.toolbar}>
        <ToolSelect
          selectedKey={String(options.orientation)}
          onSelectionChange={(selectedValue) =>
            update({ orientation: selectedValue === "l" ? "l" : "p" })
          }
          label={<>Orientation</>}
        >
          <ListBoxItem id={String("p")}>Portrait</ListBoxItem>
          <ListBoxItem id={String("l")}>Landscape</ListBoxItem>
        </ToolSelect>
        <ToolSelect
          selectedKey={String(options.format)}
          onSelectionChange={(selectedValue) =>
            update({
              format: selectedValue === "letter" ? "letter" : "a4",
            })
          }
          label={<>Paper size</>}
        >
          <ListBoxItem id={String("a4")}>A4</ListBoxItem>
          <ListBoxItem id={String("letter")}>Letter</ListBoxItem>
        </ToolSelect>
        <Button onPress={() => update({ content: sample })}>Sample</Button>
        <Button
          isDisabled={operation.busy}
          onPress={() =>
            void operation.run(
              () => generatePdf(options),
              new Blob([options.content]).size,
              (value) => value.size,
            )
          }
        >
          Generate PDF
        </Button>
      </div>
      <div className={styles.grid}>
        <div className={styles.pane}>
          <TextField
            value={options.title}
            onChange={(selectedValue) => update({ title: selectedValue })}
          >
            <Label>
              <>Document title</>
            </Label>
            <Input />
          </TextField>
          <TextField
            value={options.author}
            onChange={(selectedValue) => update({ author: selectedValue })}
          >
            <Label>
              <>Author / organisation</>
            </Label>
            <Input />
          </TextField>
          <TextField
            value={options.content}
            onChange={(selectedValue) => update({ content: selectedValue })}
          >
            <Label>
              <>Body text</>
            </Label>
            <TextArea />
          </TextField>
        </div>
        <div className={styles.pane}>
          <h3>Generated PDF preview</h3>
          {operation.result ? (
            <>
              <Button
                onPress={() => {
                  if (!operation.result) return;
                  try {
                    downloadBlob(
                      operation.result,
                      `${options.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "document"}.pdf`,
                    );
                  } catch {
                    operation.fail(
                      "Could not download. Check browser download permissions.",
                    );
                  }
                }}
              >
                Download PDF
              </Button>
              <BlobPreview
                blob={operation.result}
                kind="pdf"
                label="Generated PDF preview"
              />
            </>
          ) : (
            <p>Click Generate PDF to create a preview.</p>
          )}
        </div>
      </div>
    </ToolPanel>
  );
}
