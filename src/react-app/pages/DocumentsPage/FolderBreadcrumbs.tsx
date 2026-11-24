import { Breadcrumb, Breadcrumbs, Link } from "react-aria-components";
import { ChevronRight } from "lucide-react";
import { folderPaths } from "./documents";
import styles from "./FolderNavigation.module.css";

export function FolderBreadcrumbs({
  folder,
  onNavigate,
}: {
  folder: string;
  onNavigate: (folder: string) => void;
}) {
  const items = [
    { id: "", name: "All files" },
    ...folderPaths(folder).map((id) => ({
      id,
      name: id.slice(0, -1).split("/").at(-1) ?? id,
    })),
  ];

  return (
    <nav aria-label="Bucket folders">
      <Breadcrumbs className={styles.breadcrumbs} items={items}>
        {(item) => (
          <Breadcrumb id={item.id} className={styles.breadcrumb}>
            {({ isCurrent }) => (
              <>
                <Link
                  className={styles.breadcrumbLink}
                  onPress={() => onNavigate(item.id)}
                >
                  {item.name}
                </Link>
                {!isCurrent && <ChevronRight size={16} aria-hidden="true" />}
              </>
            )}
          </Breadcrumb>
        )}
      </Breadcrumbs>
    </nav>
  );
}
