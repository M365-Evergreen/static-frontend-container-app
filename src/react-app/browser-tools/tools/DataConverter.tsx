import {
  Button,
  ListBoxItem,
  TextField,
  Label,
  TextArea,
} from "react-aria-components";
import { ToolSelect } from "../components/ToolControls";
import { useState } from "react";
import { ToolPanel, OutputActions } from "../components/ToolPanel";
import { useToolOperation } from "../useToolOperation";
import { csvToJson, jsonToCsv } from "./DataConverter.logic";
import type { Delimiter } from "./DataConverter.logic";
import styles from "../BrowserTools.module.css";

const csvSample = 'id,name,active\r\n1,Alice,true\r\n2,"Bob, Jr.",false';
const jsonSample =
  '[{"id":1,"name":"Alice","active":true},{"id":2,"name":"Bob, Jr.","active":false}]';

export default function DataConverter() {
  const [toJson, setToJson] = useState(true);
  const [input, setInput] = useState(csvSample);
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const operation = useToolOperation<string>();
  return (
    <ToolPanel
      title="CSV / JSON Converter"
      description="Convert quoted CSV records and JSON object arrays locally."
      {...operation}
    >
      <p className={styles.note}>
        CSV values infer numbers and booleans. Leading zeros or numeric
        precision may be lost. Nested JSON values become JSON strings in CSV;
        null and missing fields become empty cells. Spreadsheet apps may execute
        formula-like CSV cells: inspect exports before opening them.
      </p>
      <div className={styles.toolbar}>
        <Button
          onPress={() => {
            setToJson(!toJson);
            setInput(
              operation.result ??
                (toJson ? jsonSample : jsonToCsv(jsonSample, delimiter)),
            );
            operation.clear();
          }}
        >
          Switch to {toJson ? "JSON to CSV" : "CSV to JSON"}
        </Button>
        <ToolSelect
          selectedKey={String(delimiter)}
          onSelectionChange={(selectedValue) => {
            const value = selectedValue;
            if (value === "," || value === "\t" || value === ";") {
              setDelimiter(value);
              operation.clear();
            }
          }}
          label={<>Delimiter</>}
        >
          <ListBoxItem id={String(",")}>Comma</ListBoxItem>
          <ListBoxItem id={String("\t")}>Tab</ListBoxItem>
          <ListBoxItem id={String(";")}>Semicolon</ListBoxItem>
        </ToolSelect>
        <Button
          onPress={() => {
            setInput(toJson ? jsonToCsv(jsonSample, delimiter) : jsonSample);
            operation.clear();
          }}
        >
          Sample
        </Button>
        <Button
          isDisabled={operation.busy}
          onPress={() =>
            void operation.run(
              () =>
                toJson
                  ? csvToJson(input, delimiter)
                  : jsonToCsv(input, delimiter),
              new Blob([input]).size,
              (value) => new Blob([value]).size,
            )
          }
        >
          Convert {toJson ? "CSV to JSON" : "JSON to CSV"}
        </Button>
      </div>
      <div className={styles.grid}>
        <div className={styles.pane}>
          <TextField
            value={input}
            onChange={(selectedValue) => {
              setInput(selectedValue);
              operation.clear();
            }}
          >
            <Label>
              <>Input {toJson ? "CSV" : "JSON"}</>
            </Label>
            <TextArea spellCheck={false} />
          </TextField>
          <Button
            onPress={() => {
              setInput("");
              operation.clear();
            }}
          >
            Clear input
          </Button>
        </div>
        <div className={styles.pane}>
          <TextField isReadOnly value={operation.result ?? ""}>
            <Label>
              <>Converted {toJson ? "JSON" : "CSV"}</>
            </Label>
            <TextArea spellCheck={false} />
          </TextField>
          <OutputActions
            key={operation.result}
            text={operation.result ?? ""}
            filename={`converted-data.${toJson ? "json" : "csv"}`}
            mime={toJson ? "application/json" : "text/csv"}
            disabled={operation.result === null}
          />
        </div>
      </div>
    </ToolPanel>
  );
}
