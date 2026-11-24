import { StrictMode } from "react";
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
import { loadAllFiles } from "../../src/react-app/components/FileGrid/files.api";
import type { FileSummary } from "../../src/shared/files";

const files: FileSummary[] = [
  {
    key: "documents/Proposal.DOCX",
    size: 2048,
    uploaded: "2026-11-24T12:00:00Z",
  },
  { key: "finance/budget.csv", size: 1024, uploaded: "2026-11-23T12:00:00Z" },
  { key: "slides/team.pptx", size: 4096, uploaded: "2026-11-22T12:00:00Z" },
  { key: "reports/meeting.pdf", size: 8192, uploaded: "2026-11-25T12:00:00Z" },
  { key: "media/cover.png", size: 16384, uploaded: "2026-11-20T12:00:00Z" },
  { key: "misc/README", size: 0, uploaded: "2026-11-19T12:00:00Z" },
  { key: "reports/Q&A #1.pdf", size: 512, uploaded: "2026-11-21T12:00:00Z" },
];

function mockBucketPages() {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ files: files.slice(0, 3), nextCursor: "next +/=" }),
    )
    .mockResolvedValueOnce(
      Response.json({ files: files.slice(3), nextCursor: null }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("bucket document browsing", () => {
  it("loads all pages with real metadata, latest-file cards and usable download links", async () => {
    const fetchMock = mockBucketPages();
    render(<DocumentsPage />);
    const table = await screen.findByRole("grid", { name: "Bucket files" });
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByText("0 B")).toBeTruthy();
    expect(within(table).getByText("2 KB")).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/files?limit=100",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/files?limit=100&cursor=next+%2B%2F%3D",
      expect.objectContaining({
        cache: "no-store",
        signal: fetchMock.mock.calls[0]?.[1].signal,
      }),
    );
    const latest = screen.getByRole("region", { name: "Recently uploaded" });
    expect(
      within(latest).getByRole("heading", { name: "meeting.pdf" }),
    ).toBeTruthy();
    expect(
      within(latest).getByRole("heading", { name: "Proposal.DOCX" }),
    ).toBeTruthy();
    expect(screen.queryByText("Owner")).toBeNull();
    expect(screen.queryByText("Opened")).toBeNull();
    const download = within(table).getByRole("link", {
      name: "Download reports/Q&A #1.pdf",
    });
    expect(download.getAttribute("href")).toBe(
      "/api/files/download?key=reports%2FQ%26A+%231.pdf",
    );
    expect(download.getAttribute("download")).toBe("Q&A #1.pdf");
  });

  it("combines case-insensitive name/folder search with accessible file-type pills and clearing", async () => {
    mockBucketPages();
    render(<DocumentsPage />);
    const table = await screen.findByRole("grid", { name: "Bucket files" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "PDFs (2)" }));
    expect(
      screen
        .getByRole("radio", { name: "PDFs (2)" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(
      screen.queryByRole("region", { name: "Recently uploaded" }),
    ).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "  Q&A  " },
    });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(
      within(table).getByRole("link", { name: "Q&A #1.pdf" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search files" }), {
      target: { value: "COVER" },
    });
    expect(
      within(table).getByText(
        "No files match your search or selected file type.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Images (1)" }));
    expect(within(table).getByRole("link", { name: "cover.png" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear file search" }));
    await user.click(screen.getByRole("radio", { name: "All files (7)" }));
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    await user.click(screen.getByRole("radio", { name: "Documents (1)" }));
    expect(
      within(table).getByRole("link", { name: "Proposal.DOCX" }),
    ).toBeTruthy();
  });

  it("sorts actual metadata using the table headers", async () => {
    mockBucketPages();
    render(<DocumentsPage />);
    const table = await screen.findByRole("grid", { name: "Bucket files" });
    const user = userEvent.setup();
    await user.click(within(table).getByRole("columnheader", { name: "Size" }));
    expect(
      within(table)
        .getByRole("columnheader", { name: "Size" })
        .getAttribute("aria-sort"),
    ).toBe("ascending");
    const first = within(table).getAllByRole("row")[1];
    if (!first) throw new Error("The first file row is missing.");
    expect(within(first).getByRole("link", { name: "README" })).toBeTruthy();
  });

  it("does not show partial results when a later page fails, and retries an empty bucket honestly", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ files: files.slice(0, 3), nextCursor: "next" }),
        )
        .mockResolvedValueOnce(
          Response.json(
            { error: { message: "Bucket temporarily unavailable." } },
            { status: 503 },
          ),
        )
        .mockResolvedValueOnce(Response.json({ files: [], nextCursor: null })),
    );
    render(<DocumentsPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Bucket temporarily unavailable.",
    );
    expect(screen.queryByRole("grid")).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry files" }));
    expect(
      await screen.findByText("No files are available in this bucket."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Recently uploaded" }),
    ).toBeNull();
  });

  it("aborts bucket listing on unmount under StrictMode", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        if (init.signal) signals.push(init.signal);
        return new Promise<Response>(() => {});
      }),
    );
    const { unmount } = render(
      <StrictMode>
        <DocumentsPage />
      </StrictMode>,
    );
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]?.aborted).toBe(true);
    unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

describe("bucket page validation", () => {
  it.each([
    { files: [], nextCursor: "" },
    { files: [] },
    {
      files: [{ key: "bad.pdf", size: -1, uploaded: "2026-11-24T12:00:00Z" }],
      nextCursor: null,
    },
    {
      files: [{ key: "bad.pdf", size: 1, uploaded: "invalid date" }],
      nextCursor: null,
    },
  ])("rejects invalid file pages: %j", async (payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload)),
    );
    await expect(loadAllFiles(new AbortController().signal)).rejects.toThrow(
      /invalid file/,
    );
  });

  it("rejects repeated cursors rather than fetching forever", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ files: [], nextCursor: "repeat" }))
      .mockResolvedValueOnce(
        Response.json({ files: [], nextCursor: "repeat" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadAllFiles(new AbortController().signal)).rejects.toThrow(
      "repeated file pagination cursor",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate keys across pages rather than silently replacing files", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ files: files.slice(0, 1), nextCursor: "next" }),
        )
        .mockResolvedValueOnce(
          Response.json({ files: files.slice(0, 1), nextCursor: null }),
        ),
    );
    await expect(loadAllFiles(new AbortController().signal)).rejects.toThrow(
      "duplicate files across pages",
    );
  });

  it("does not fetch when the listing was already cancelled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(loadAllFiles(controller.signal)).rejects.toHaveProperty(
      "name",
      "AbortError",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
