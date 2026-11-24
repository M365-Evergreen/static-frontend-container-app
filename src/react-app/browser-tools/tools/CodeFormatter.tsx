import {
  ListBoxItem,
  Button,
  TextField,
  Label,
  TextArea,
} from "react-aria-components";
import { ToolSelect, ToolCheckbox } from "../components/ToolControls";
import { useState } from "react";
import { ToolPanel, OutputActions } from "../components/ToolPanel";
import { useToolOperation } from "../useToolOperation";
import { formatCode, languages, samples } from "./CodeFormatter.logic";
import type { Language } from "./CodeFormatter.logic";
import styles from "../BrowserTools.module.css";

export default function CodeFormatter() {
  const [language, setLanguage] = useState<Language>("javascript");
  const [input, setInput] = useState(samples.javascript);
  const [tabWidth, setTabWidth] = useState(2);
  const [singleQuote, setSingleQuote] = useState(true);
  const [semi, setSemi] = useState(true);
  const operation = useToolOperation<string>();
  return (
    <ToolPanel
      title="Code Formatter"
      description="Format six languages with Prettier, entirely in this browser."
      {...operation}
    >
      <div className={styles.toolbar}>
        <ToolSelect
          selectedKey={String(language)}
          onSelectionChange={(selectedValue) => {
            const next = languages.find((item) => item === selectedValue);
            if (next) {
              setLanguage(next);
              setInput(samples[next]);
              operation.clear();
            }
          }}
          label={<>Language</>}
        >
          {languages.map((item) => (
            <ListBoxItem id={String(item)} key={item}>
              {item}
            </ListBoxItem>
          ))}
        </ToolSelect>
        <ToolSelect
          selectedKey={String(tabWidth)}
          onSelectionChange={(selectedValue) => {
            setTabWidth(Number(selectedValue));
            operation.clear();
          }}
          label={<>Tab width</>}
        >
          <ListBoxItem id={String("2")}>2 spaces</ListBoxItem>
          <ListBoxItem id={String("4")}>4 spaces</ListBoxItem>
        </ToolSelect>
        <ToolCheckbox
          className={styles.checkbox}
          isSelected={singleQuote}
          onChange={(selected) => {
            setSingleQuote(selected);
            operation.clear();
          }}
        >
          <>Single quotes</>
        </ToolCheckbox>
        <ToolCheckbox
          className={styles.checkbox}
          isSelected={semi}
          onChange={(selected) => {
            setSemi(selected);
            operation.clear();
          }}
        >
          <>Semicolons</>
        </ToolCheckbox>
        <Button
          onPress={() => {
            setInput(samples[language]);
            operation.clear();
          }}
        >
          Sample
        </Button>
        <Button
          isDisabled={operation.busy}
          onPress={() =>
            void operation.run(
              () => formatCode(input, language, tabWidth, singleQuote, semi),
              new Blob([input]).size,
              (value) => new Blob([value]).size,
            )
          }
        >
          Format code
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
              <>Input code</>
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
              <>Formatted output</>
            </Label>
            <TextArea spellCheck={false} />
          </TextField>
          <OutputActions
            key={operation.result}
            text={operation.result ?? ""}
            filename={`formatted.${{ javascript: "js", typescript: "ts", json: "json", html: "html", css: "css", markdown: "md" }[language]}`}
            disabled={operation.result === null}
          />
        </div>
      </div>
    </ToolPanel>
  );
}
