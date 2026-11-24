import {
  Button,
  Collection,
  Tree,
  TreeItem,
  TreeItemContent,
  type Key,
} from "react-aria-components";
import { ChevronRight, Files, Folder, FolderOpen } from "lucide-react";
import type { BucketFolder } from "./documents";
import styles from "./FolderNavigation.module.css";

function renderFolder(folder: BucketFolder) {
  return (
    <TreeItem
      id={folder.id}
      textValue={folder.name}
      aria-label={folder.name}
      className={styles.treeItem}
    >
      <TreeItemContent>
        {({ hasChildItems, isExpanded }) => {
          const Icon = isExpanded ? FolderOpen : Folder;
          return (
            <>
              <Button
                slot="chevron"
                className={styles.chevron}
                aria-label={isExpanded ? "Collapse" : "Expand"}
                isDisabled={!hasChildItems}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
              <Icon
                size={19}
                className={styles.folderIcon}
                aria-hidden="true"
              />
              <span className={styles.folderName} title={folder.id}>
                {folder.name}
              </span>
            </>
          );
        }}
      </TreeItemContent>
      <Collection items={folder.children}>{renderFolder}</Collection>
    </TreeItem>
  );
}

export function FolderTree({
  folders,
  folder,
  expandedKeys,
  onExpandedChange,
  onNavigate,
}: {
  folders: BucketFolder[];
  folder: string;
  expandedKeys: Set<Key>;
  onExpandedChange: (keys: Set<Key>) => void;
  onNavigate: (folder: string) => void;
}) {
  return (
    <aside className={styles.treePanel} aria-label="Folder navigation">
      <h2 className={styles.treeHeading}>Folders</h2>
      <Tree
        aria-label="Bucket folder tree"
        className={styles.tree}
        selectionMode="single"
        selectionBehavior="replace"
        disallowEmptySelection
        selectedKeys={new Set([folder])}
        expandedKeys={expandedKeys}
        onExpandedChange={onExpandedChange}
        onSelectionChange={(keys) => {
          if (keys === "all") return;
          const key = [...keys][0];
          if (typeof key === "string") onNavigate(key);
        }}
      >
        <TreeItem
          id=""
          textValue="All files"
          aria-label="All files"
          className={styles.treeItem}
        >
          <TreeItemContent>
            <span className={styles.chevronSpacer} />
            <Files size={19} aria-hidden="true" />
            <span className={styles.folderName}>All files</span>
          </TreeItemContent>
        </TreeItem>
        <Collection items={folders}>{renderFolder}</Collection>
      </Tree>
    </aside>
  );
}
