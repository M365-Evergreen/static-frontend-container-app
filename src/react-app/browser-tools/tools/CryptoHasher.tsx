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
import {
  algorithms,
  hashBytes,
  encodeBase64,
  decodeBase64,
} from "./CryptoHasher.logic";
import type { HashAlgorithm } from "./CryptoHasher.logic";
import styles from "../BrowserTools.module.css";

const modes = [
  "Hash",
  "Base64 encode",
  "Base64 decode",
  "URI encode",
  "URI decode",
] as const;
type Mode = (typeof modes)[number];

export default function CryptoHasher() {
  const [input, setInput] = useState("Browser tools");
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>("SHA-256");
  const [mode, setMode] = useState<Mode>("Hash");
  const [file, setFile] = useState<File | null>(null);
  const operation = useToolOperation<string>();
  return (
    <ToolPanel
      title="WebCrypto & Base64"
      description="Hash text or files, or encode/decode UTF-8 text and URI components."
      {...operation}
    >
      <div className={styles.toolbar}>
        <ToolSelect
          selectedKey={String(mode)}
          onSelectionChange={(selectedValue) => {
            const next = modes.find((item) => item === selectedValue);
            if (next) {
              setMode(next);
              operation.clear();
            }
          }}
          label={<>Operation</>}
        >
          {modes.map((item) => (
            <ListBoxItem id={String(item)} key={item}>
              {item}
            </ListBoxItem>
          ))}
        </ToolSelect>
        <ToolSelect
          selectedKey={String(algorithm)}
          isDisabled={mode !== "Hash"}
          onSelectionChange={(selectedValue) => {
            const next = algorithms.find((item) => item === selectedValue);
            if (next) {
              setAlgorithm(next);
              operation.clear();
            }
          }}
          label={<>Hash algorithm</>}
        >
          {algorithms.map((item) => (
            <ListBoxItem id={String(item)} key={item}>
              {item}
            </ListBoxItem>
          ))}
        </ToolSelect>
        <Button
          isDisabled={operation.busy}
          onPress={() =>
            void operation.run(
              async () => {
                if (mode === "Hash")
                  return hashBytes(
                    new TextEncoder().encode(input).buffer,
                    algorithm,
                  );
                if (mode === "Base64 encode") return encodeBase64(input);
                if (mode === "Base64 decode") return decodeBase64(input);
                if (mode === "URI encode") return encodeURIComponent(input);
                return decodeURIComponent(input);
              },
              new Blob([input]).size,
              (value) => new Blob([value]).size,
            )
          }
        >
          Run text operation
        </Button>
      </div>
      <p className={styles.note}>
        SHA-1 is a legacy checksum, not a secure choice for signatures. Hashing
        is not encryption. A file is read entirely into memory. Base64 decode
        expects padded Base64 and valid UTF-8; URI actions operate on a URI
        component.
      </p>
      <div className={styles.toolbar}>
        <div>
          <FileTrigger
            onSelect={(files) => {
              setFile(files?.[0] ?? null);
              operation.clear();
            }}
          >
            <Button>
              <>Local file for checksum</>
            </Button>
          </FileTrigger>
        </div>
        <Button
          isDisabled={!file || operation.busy}
          onPress={() => {
            if (file)
              void operation.run(
                async () => hashBytes(await file.arrayBuffer(), algorithm),
                file.size,
                (value) => value.length,
              );
          }}
        >
          Hash selected file ({algorithm})
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
              <>Input string</>
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
              <>Result</>
            </Label>
            <TextArea spellCheck={false} />
          </TextField>
          <OutputActions
            key={operation.result}
            text={operation.result ?? ""}
            filename="crypto-result.txt"
            disabled={operation.result === null}
          />
        </div>
      </div>
    </ToolPanel>
  );
}
