import HtmlToJsonConverter from "../components/HTMLtoJSON";
import styles from "../browser-tools/BrowserTools.module.css";

export function ToolsPage() {
  return (
    <div className={styles.root}>
      <HtmlToJsonConverter />
    </div>
  );
}

export default ToolsPage;
