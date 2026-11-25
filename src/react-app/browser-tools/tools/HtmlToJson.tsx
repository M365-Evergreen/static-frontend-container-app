import {
  Button,
  FileTrigger,
  Label,
  TextArea,
  TextField,
} from "react-aria-components";
import { useState } from "react";
import { ToolPanel, OutputActions } from "../components/ToolPanel";
import { useToolOperation } from "../useToolOperation";
import { convertHtmlToJson } from "./HtmlToJson.logic";
import styles from "../BrowserTools.module.css";

const sample =
  '<div class="card" id="promo">\n  <h2>Welcome</h2>\n  <p>Convert <strong>HTML</strong> to JSON.</p>\n</div>';

export default function HtmlToJson() {
  const [input, setInput] = useState(sample);
  const reader = useToolOperation<string>();
  const operation = useToolOperation<string>();
  const source = reader.result ?? input;

  return (
    <ToolPanel
      title="HTML to JSON"
      description="Convert HTML elements and attributes into a structured JSON document locally."
      error={reader.error || operation.error}
      busy={reader.busy || operation.busy}
      stats={operation.stats}
    >
      <div className={styles.toolbar}>
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
          <Button>Local HTML file</Button>
        </FileTrigger>
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
              () => convertHtmlToJson(source),
              new Blob([source]).size,
              (value) => new Blob([value]).size,
            )
          }
        >
          Convert to JSON
        </Button>
      </div>
      <div className={styles.grid}>
        <div className={styles.pane}>
          <TextField
            value={source}
            onChange={(value) => {
              setInput(value);
              reader.clear();
              operation.clear();
            }}
          >
            <Label>
              <>HTML input</>
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
              <>JSON output</>
            </Label>
            <TextArea spellCheck={false} />
          </TextField>
          <OutputActions
            key={operation.result}
            text={operation.result ?? ""}
            filename="document.json"
            mime="application/json"
            disabled={operation.result === null}
          />
        </div>
      </div>
    </ToolPanel>
  );
}
