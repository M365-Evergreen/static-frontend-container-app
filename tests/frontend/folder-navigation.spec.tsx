import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentsPage } from "../../src/react-app/pages/DocumentsPage/DocumentsPage";
import { FolderBreadcrumbs } from "../../src/react-app/pages/DocumentsPage/FolderBreadcrumbs";

const uploaded = "2026-11-25T12:00:00Z";
const keys = [
  "reports/2026/November/summary.md",
  "reports/2026/December/summary.md",
  "reports/2026/November/empty/",
  "reports/2025/archive.pdf",
  "reports-old/private.txt",
  "other/2026/notes.txt",
  "empty/",
  "root.txt",
];

function renderBucket() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        files: keys.map((key) => ({
          key,
          size: key.endsWith("/") ? 0 : 5,
          uploaded,
        })),
        nextCursor: null,
      }),
    ),
  );
  return render(<DocumentsPage />);
}

describe("folder tree navigation", () => {
  it("expands inferred and empty folders, navigates into a subtree, and returns via breadcrumbs", async () => {
    renderBucket();
    const user = userEvent.setup();
    const tree = await screen.findByRole("treegrid", {
      name: "Bucket folder tree",
    });
    expect(
      within(tree)
        .getByRole("row", { name: "All files" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    const reports = within(tree).getByRole("row", { name: "reports" });
    expect(reports.getAttribute("aria-expanded")).toBe("false");
    expect(within(tree).queryByRole("row", { name: "November" })).toBeNull();
    await user.click(
      within(reports).getByRole("button", { name: "Expand reports" }),
    );
    await user.click(
      within(within(tree).getByRole("row", { name: "2026" })).getByRole(
        "button",
        { name: "Expand 2026" },
      ),
    );
    await user.click(within(tree).getByRole("row", { name: "November" }));
    expect(
      within(tree)
        .getByRole("row", { name: "November" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    const table = screen.getByRole("grid", { name: "Bucket files" });
    expect(
      within(table).getByText("reports/2026/November/summary.md"),
    ).toBeTruthy();
    expect(
      within(table).queryByText("reports/2026/December/summary.md"),
    ).toBeNull();
    expect(within(table).queryByText("reports-old/private.txt")).toBeNull();
    const breadcrumbs = screen.getByRole("navigation", {
      name: "Bucket folders",
    });
    const links = within(breadcrumbs).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "All files",
      "reports",
      "2026",
      "November",
    ]);
    expect(links.at(-1)?.getAttribute("aria-current")).toBe("page");
    const header = screen
      .getByRole("heading", { name: "Files", level: 1 })
      .closest("header");
    expect(header?.nextElementSibling).toBe(breadcrumbs);
    await user.click(
      within(breadcrumbs).getByRole("link", { name: "reports" }),
    );
    expect(
      within(tree)
        .getByRole("row", { name: "reports" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("Showing 3 of 3 files")).toBeTruthy();
    await user.click(
      within(breadcrumbs).getByRole("link", { name: "All files" }),
    );
    expect(screen.getByText("Showing 6 of 6 files")).toBeTruthy();
    await user.click(within(tree).getByRole("row", { name: "empty" }));
    expect(screen.getByText("Showing 0 of 0 files")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download empty/" })).toBeNull();
  });

  it("supports keyboard expansion, folder selection and collapsing without changing the current folder", async () => {
    renderBucket();
    const user = userEvent.setup();
    const tree = await screen.findByRole("treegrid", {
      name: "Bucket folder tree",
    });
    const reports = within(tree).getByRole("row", { name: "reports" });
    await user.click(reports);
    await user.keyboard("{ArrowRight}");
    expect(reports.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(
        within(tree)
          .getByRole("row", { name: "2025" })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(screen.getByText("Showing 1 of 1 files")).toBeTruthy();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(reports.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowLeft}");
    expect(reports.getAttribute("aria-expanded")).toBe("false");
    expect(within(tree).queryByRole("row", { name: "2025" })).toBeNull();
    expect(
      within(screen.getByRole("navigation", { name: "Bucket folders" }))
        .getByRole("link", { name: "reports" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("reveals selected ancestors after folder-card navigation, retains expansion on refresh and scopes upload destinations", async () => {
    renderBucket();
    const user = userEvent.setup();
    const tree = await screen.findByRole("treegrid", {
      name: "Bucket folder tree",
    });
    await user.click(
      within(screen.getByRole("region", { name: "Folders" })).getByRole(
        "button",
        { name: "reports" },
      ),
    );
    await user.click(
      within(screen.getByRole("region", { name: "Folders" })).getByRole(
        "button",
        { name: "2026" },
      ),
    );
    await user.click(
      within(screen.getByRole("region", { name: "Folders" })).getByRole(
        "button",
        { name: "November" },
      ),
    );
    expect(
      within(tree)
        .getByRole("row", { name: "reports" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      within(tree)
        .getByRole("row", { name: "2026" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      within(tree)
        .getByRole("row", { name: "November" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "nonexistent" },
    });
    await user.click(within(tree).getByRole("row", { name: "2026" }));
    expect(
      (
        screen.getByRole("searchbox", {
          name: "Search files",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    await user.click(screen.getByRole("button", { name: "Refresh files" }));
    const refreshedTree = await screen.findByRole("treegrid", {
      name: "Bucket folder tree",
    });
    expect(
      within(refreshedTree)
        .getByRole("row", { name: "2026" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      within(refreshedTree)
        .getByRole("row", { name: "reports" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await user.click(screen.getByRole("button", { name: "Create or upload" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Destination folder",
        }) as HTMLInputElement
      ).value,
    ).toBe("reports/2026/");
  });
});

it("keeps repeated folder names distinct and navigates to the exact breadcrumb prefix", async () => {
  const navigate = vi.fn();
  const view = render(
    <FolderBreadcrumbs
      folder="reports/reports/Q&A #1/"
      onNavigate={navigate}
    />,
  );
  const user = userEvent.setup();
  const links = screen.getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    "All files",
    "reports",
    "reports",
    "Q&A #1",
  ]);
  const ancestor = links[2];
  if (!ancestor) throw new Error("Missing repeated folder ancestor");
  await user.click(ancestor);
  expect(navigate).toHaveBeenLastCalledWith("reports/reports/");
  view.rerender(<FolderBreadcrumbs folder="" onNavigate={navigate} />);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(
    screen
      .getByRole("link", { name: "All files" })
      .getAttribute("aria-current"),
  ).toBe("page");
});
