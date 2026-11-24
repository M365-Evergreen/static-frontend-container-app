import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Button,
  Input,
  Label,
  Link,
  SearchField,
  RouterProvider,
} from "react-aria-components";
import { Search, X } from "lucide-react";
import { toolPath, tools } from "./toolRegistry";
import styles from "./BrowserTools.module.css";

export default function BrowserToolsLayout() {
  const [query, setQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [location.pathname]);

  return (
    <RouterProvider navigate={navigate}>
      <div className={styles.root}>
        <header className={styles.hero}>
          <h1 ref={heading} tabIndex={-1}>
            Browser tools
          </h1>
          <p>
            Developer utilities for text, documents and images. Tool input and
            output stay in your browser, with no tool-data uploads.
          </p>
        </header>
        <p className={styles.notice}>
          Large inputs can consume substantial memory or freeze the tab.
          Processing has no application size cap, but browser limits still
          apply. Files are read in full. Inputs and results are discarded when
          you leave a tool.
        </p>
        <SearchField
          value={query}
          onChange={setQuery}
          className={styles.search}
        >
          <Label>Search tools</Label>
          <div className={styles.searchInput}>
            <Search size={18} aria-hidden="true" />
            <Input placeholder="Search tools, formats or keywords..." />
            <Button aria-label="Clear tool search">
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        </SearchField>
        <nav className={styles.navigation} aria-label="Browser tools">
          <Link
            href="/browser-tools"
            aria-current={
              location.pathname === "/browser-tools" ? "page" : undefined
            }
          >
            All tools
          </Link>
          {tools.map((tool) => (
            <Link
              key={tool.id}
              href={toolPath(tool.id)}
              aria-current={
                location.pathname === toolPath(tool.id) ||
                location.pathname.startsWith(`${toolPath(tool.id)}/`)
                  ? "page"
                  : undefined
              }
            >
              {tool.name}
            </Link>
          ))}
        </nav>
        <Outlet context={{ query }} />
      </div>
    </RouterProvider>
  );
}
