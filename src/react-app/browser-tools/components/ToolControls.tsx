import type { ReactNode } from "react";
import {
  Button,
  Checkbox,
  Label,
  ListBox,
  Popover,
  Select,
  SelectValue,
  type CheckboxProps,
} from "react-aria-components";
import { Check, ChevronDown } from "lucide-react";
import styles from "../BrowserTools.module.css";

export function ToolSelect({
  label,
  children,
  selectedKey,
  onSelectionChange,
  isDisabled,
  className,
  "aria-label": ariaLabel,
}: {
  label?: ReactNode;
  children: ReactNode;
  selectedKey: string;
  onSelectionChange: (value: string) => void;
  isDisabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select
      className={`${styles.field} ${className ?? ""}`}
      aria-label={ariaLabel}
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        if (key !== null) onSelectionChange(String(key));
      }}
      isDisabled={isDisabled}
    >
      {label && <Label>{label}</Label>}
      <Button className={styles.selectButton}>
        <SelectValue />
        <ChevronDown size={16} aria-hidden="true" />
      </Button>
      <Popover className={styles.selectPopover} data-tool-select-popover>
        <ListBox className={styles.options}>{children}</ListBox>
      </Popover>
    </Select>
  );
}

export function ToolCheckbox({ children, className, ...props }: CheckboxProps) {
  return (
    <Checkbox
      {...props}
      className={`${styles.checkControl} ${typeof className === "string" ? className : ""}`}
    >
      {(state) => (
        <>
          <span className={styles.checkIndicator} aria-hidden="true">
            {state.isSelected && <Check size={14} />}
          </span>
          {typeof children === "function" ? children(state) : children}
        </>
      )}
    </Checkbox>
  );
}
