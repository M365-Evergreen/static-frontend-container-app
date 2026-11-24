import {
  Button,
  TextField,
  Label,
  Input,
  ListBoxItem,
  TextArea,
} from "react-aria-components";
import { ToolCheckbox, ToolSelect } from "../components/ToolControls";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  themeRulesStandardCreator,
  ThemeGenerator,
  BaseSlots,
} from "@fluentui/react/lib/ThemeGenerator";
import { getColorFromString, isDark } from "@fluentui/react/lib/Color";
import { ToolPanel, OutputActions } from "../components/ToolPanel";
import { copyText } from "../browserIO";
import {
  normalizeColor,
  validatePalette,
  exportPalette,
  presets,
  paletteSlots,
} from "./ThemeDesigner.logic";
import type { ExportFormat } from "./ThemeDesigner.logic";
import styles from "../BrowserTools.module.css";

export default function ThemeDesigner() {
  const [colors, setColors] = useState(presets[0]);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [copyStatus, setCopyStatus] = useState("");
  const [copyError, setCopyError] = useState("");
  const copyRequest = useRef(0);
  useEffect(
    () => () => {
      copyRequest.current++;
    },
    [],
  );
  const generated = useMemo(() => {
    try {
      const primary = getColorFromString(normalizeColor(colors.primary));
      const text = getColorFromString(normalizeColor(colors.text));
      const background = getColorFromString(normalizeColor(colors.background));
      if (!primary || !text || !background)
        throw new Error("The selected colors could not be parsed.");
      const inverted = isDark(background);
      const rules = themeRulesStandardCreator();
      ThemeGenerator.insureSlots(rules, inverted);
      const primaryRule = rules[BaseSlots[BaseSlots.primaryColor]];
      const foregroundRule = rules[BaseSlots[BaseSlots.foregroundColor]];
      const backgroundRule = rules[BaseSlots[BaseSlots.backgroundColor]];
      if (!primaryRule || !foregroundRule || !backgroundRule)
        throw new Error("Fluent theme base slots are unavailable.");
      ThemeGenerator.setSlot(primaryRule, primary, inverted, true, true);
      ThemeGenerator.setSlot(foregroundRule, text, inverted, true, true);
      ThemeGenerator.setSlot(backgroundRule, background, inverted, true, true);
      return {
        palette: validatePalette(ThemeGenerator.getThemeAsJson(rules)),
        inverted,
        error: "",
      };
    } catch (reason) {
      return {
        palette: null,
        inverted: false,
        error:
          reason instanceof Error
            ? reason.message
            : "Could not generate the palette.",
      };
    }
  }, [colors]);
  const output = generated.palette
    ? exportPalette(generated.palette, format, generated.inverted)
    : "";
  function updateColor(key: "primary" | "text" | "background", value: string) {
    copyRequest.current++;
    setColors({ ...colors, [key]: value });
    setCopyStatus("");
    setCopyError("");
  }
  return (
    <ToolPanel
      title="Fluent Theme Designer"
      description="Generate the supplied 23-slot Microsoft Fluent palette. Preview changes do not change the blog theme."
      error={generated.error || copyError}
    >
      <div className={styles.actions}>
        {presets.map((preset) => (
          <Button
            key={preset.name}
            onPress={() => {
              copyRequest.current++;
              setColors(preset);
              setCopyStatus("");
              setCopyError("");
            }}
          >
            {preset.name}
          </Button>
        ))}
      </div>
      <div className={styles.toolbar}>
        {(["primary", "text", "background"] as const).map((key) => {
          let picker = "#000000";
          try {
            picker = normalizeColor(colors[key]);
          } catch {
            /* The adjacent field displays the validation error. */
          }
          return (
            <div key={key} className={styles.pane}>
              <label>
                {key} color picker
                <input
                  type="color"
                  value={picker}
                  onChange={(event) => updateColor(key, event.target.value)}
                />
              </label>
              <TextField
                value={colors[key]}
                isInvalid={Boolean(generated.error)}
                onChange={(selectedValue) => updateColor(key, selectedValue)}
              >
                <Label>
                  <>{key} hex color</>
                </Label>
                <Input />
              </TextField>
            </div>
          );
        })}
      </div>
      {generated.palette && (
        <div
          className={styles.colorPreview}
          style={{
            background: generated.palette.white,
            color: generated.palette.neutralPrimary,
          }}
        >
          <h3>Theme live simulation</h3>
          <p>
            Preview of your generated foreground, background and brand colors.
          </p>
          <div className={styles.actions}>
            <Button
              style={{
                background: generated.palette.themePrimary,
                color: generated.palette.white,
              }}
            >
              Primary button preview
            </Button>
            <Button
              style={{
                background: generated.palette.white,
                color: generated.palette.neutralPrimary,
                borderColor: generated.palette.neutralSecondary,
              }}
            >
              Default button preview
            </Button>
            <ToolCheckbox
              className={styles.checkbox}
              defaultSelected={true}
              style={{ accentColor: generated.palette.themePrimary }}
            >
              <>Active option</>
            </ToolCheckbox>
          </div>
          <a
            href="#theme-export"
            style={{ color: generated.palette.themePrimary }}
          >
            Theme export
          </a>
        </div>
      )}
      {generated.palette && (
        <div className={styles.swatches}>
          {paletteSlots.map((slot) => (
            <Button
              className={styles.swatch}
              key={slot}
              aria-label={`Copy ${slot} ${generated.palette[slot]}`}
              onPress={async () => {
                const request = ++copyRequest.current;
                try {
                  await copyText(generated.palette[slot]);
                  if (request === copyRequest.current) {
                    setCopyStatus(`Copied ${slot}`);
                    setCopyError("");
                  }
                } catch {
                  if (request === copyRequest.current) {
                    setCopyStatus("");
                    setCopyError(
                      "Could not copy the color. Check clipboard permissions.",
                    );
                  }
                }
              }}
            >
              <span style={{ background: generated.palette[slot] }} />
              <span>{slot}</span>
              <span>{generated.palette[slot]}</span>
            </Button>
          ))}
        </div>
      )}
      {copyStatus && <p role="status">{copyStatus}</p>}
      <section className={styles.pane} id="theme-export">
        <ToolSelect
          selectedKey={String(format)}
          onSelectionChange={(selectedValue) => {
            const value = selectedValue;
            if (value === "json" || value === "css" || value === "powershell")
              setFormat(value);
          }}
          label={<>Export format</>}
        >
          <ListBoxItem id={String("json")}>JSON</ListBoxItem>
          <ListBoxItem id={String("css")}>CSS variables</ListBoxItem>
          <ListBoxItem id={String("powershell")}>
            SharePoint PowerShell (download only)
          </ListBoxItem>
        </ToolSelect>
        <TextField isReadOnly value={output}>
          <Label>
            <>Exported theme</>
          </Label>
          <TextArea spellCheck={false} />
        </TextField>
        <OutputActions
          key={output}
          text={output}
          filename={`fluent-theme.${format === "powershell" ? "ps1" : format}`}
          mime={
            format === "json"
              ? "application/json"
              : format === "css"
                ? "text/css"
                : "text/plain"
          }
          disabled={!generated.palette}
        />
      </section>
    </ToolPanel>
  );
}
