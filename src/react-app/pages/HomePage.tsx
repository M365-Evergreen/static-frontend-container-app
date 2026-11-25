import Agent from '../components/Agent/Agent';
import { FileGrid } from '../components/FileGrid/FileGrid';
import HtmlToJsonConverter from '../components/HTMLtoJSON';
export function HomePage() {
  return (
    <div>
      PAULIBABY
      <FileGrid />
      <HtmlToJsonConverter />
      <Agent />
    </div>
  );
}