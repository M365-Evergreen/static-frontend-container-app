import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentViewer } from "../../src/react-app/pages/DocumentsPage/DocumentViewer";
import { DocumentsPage } from "../../src/react-app/pages/DocumentsPage/DocumentsPage";
import {
  loadDocumentPreview,
  textPreviewLimit,
} from "../../src/react-app/pages/DocumentsPage/document-preview";
import type { FileSummary } from "../../src/shared/files";

function file(key = "folder/notes.txt", size = 10): FileSummary {
  return { key, size, uploaded: "2026-11-25T12:00:00Z" };
}
function Harness({ document }: { document: FileSummary }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <DocumentViewer file={document} onClose={() => setOpen(false)} />
  ) : null;
}
function renderText(key: string, content: string) {
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >(async () => new Response(content));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<Harness document={file(key)} />);
  return { ...view, fetchMock };
}
function mockObjectUrls() {
  const create = vi.fn<(blob: Blob) => string>(() => "blob:local-document");
  const revoke = vi.fn<(url: string) => void>();
  class PreviewURL extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  }
  vi.stubGlobal("URL", PreviewURL);
  return { create, revoke };
}

describe("read-only document viewing", () => {
  it("opens JSON from the file name in a modal, formats without changing values, and keeps original downloads", async () => {
    const item = file("config/settings.json");
    const original =
      '{"big":9007199254740993123,"enabled":true,"nested":{"count":2}}';
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async (url) =>
      url.startsWith("/api/files?")
        ? Response.json({ files: [item], nextCursor: null })
        : new Response(original, {
            headers: { "Content-Type": "application/json" },
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DocumentsPage />);
    const table = await screen.findByRole("grid", { name: "Bucket files" });
    const trigger = within(table).getByRole("button", {
      name: "settings.json",
    });
    const user = userEvent.setup();
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "settings.json" });
    const content = await within(dialog).findByLabelText(
      "Document content",
      {},
      { timeout: 10_000 },
    );
    expect(content.textContent).toContain('"big": 9007199254740993123');
    expect(content.textContent).toContain(
      '\n  "nested": {\n    "count": 2\n  }',
    );
    expect(content.querySelector(".token.property")).toBeTruthy();
    expect(within(dialog).getByText("Read-only")).toBeTruthy();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    const download = within(dialog).getByRole("link", {
      name: "Download original",
    });
    expect(download.getAttribute("href")).toBe(
      "/api/files/download?key=config%2Fsettings.json",
    );
    await user.click(
      within(dialog).getByRole("radio", { name: "Original text" }),
    );
    expect(content.textContent).toBe(original);
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => !init?.method || init.method === "GET",
      ),
    ).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("formats and highlights TSX as inert source code", async () => {
    const source =
      "export default function Card({name}:{name:string}){return <article><h1>{name}</h1></article>}";
    renderText("components/Card.TSX", source);
    const content = await screen.findByLabelText("Document content");
    expect(screen.getByText("TypeScript JSX")).toBeTruthy();
    expect(content.textContent).toContain("export default function Card(");
    expect(content.textContent).toContain(
      "\n    <article>\n      <h1>{name}</h1>\n    </article>",
    );
    expect(content.querySelector(".token.keyword")).toBeTruthy();
    expect(content.querySelector("article")).toBeNull();
    expect(
      screen
        .getByRole("radio", { name: "Formatted" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("shows original invalid JSON with an explicit formatting warning", async () => {
    const original = '{"unfinished":';
    renderText("broken.json", original);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Formatting unavailable; showing the original text.",
    );
    expect(screen.getByLabelText("Document content").textContent).toBe(
      original,
    );
    expect(screen.queryByRole("radio", { name: "Formatted" })).toBeNull();
  });

  it("renders Markdown safely and allows switching to its original source", async () => {
    const original =
      "# Report\n\n| Name | Count |\n| --- | --- |\n| Team | 2 |\n\n<script>window.attacked=true</script>\n\n![remote](https://external.test/private.png)\n\n[bad](javascript:alert(1))";
    renderText("readme.md", original);
    expect(await screen.findByRole("heading", { name: "Report" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Team" })).toBeTruthy();
    expect(screen.getByText("Image unavailable: remote")).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("script")).toBeNull();
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector('a[href^="javascript:"]')).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("radio", { name: "Original text" }));
    expect(screen.getByLabelText("Document content").textContent).toContain(
      "# Report",
    );
  });

  it.each(["html", "svg"])(
    "never executes or mounts active %s content",
    async (extension) => {
      renderText(
        `unsafe.${extension}`,
        '<svg id="unsafe"><script>window.attacked=true</script></svg>',
      );
      const content = await screen.findByLabelText("Document content");
      expect(content.textContent).toContain("<script>");
      expect(screen.getByRole("dialog").querySelector("#unsafe")).toBeNull();
    },
  );

  it("renders quoted CSV fields as a read-only table without coercing values", async () => {
    renderText(
      "data.csv",
      'id,description\n0001,"Hello, world"\n0002,"two\nlines"\n',
    );
    const table = await screen.findByRole("table", { name: "CSV content" });
    expect(within(table).getByRole("cell", { name: "0001" })).toBeTruthy();
    expect(
      within(table).getByRole("cell", { name: "Hello, world" }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("cell", { name: /two\s+lines/ }),
    ).toBeTruthy();
    expect(within(table).queryByRole("textbox")).toBeNull();
  });

  it.each([
    ["photo.png", "not executed as HTML", "image/png", "img"],
    ["report.pdf", "%PDF-1.7\nPDF document bytes", "application/pdf", "iframe"],
    ["recording.mp3", "audio bytes", "audio/mpeg", "audio"],
  ])(
    "previews %s locally with a forced type and releases its object URL on close",
    async (key, body, mimeType, tag) => {
      const { create, revoke } = mockObjectUrls();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(body, { headers: { "Content-Type": "text/html" } }),
        ),
      );
      render(<Harness document={file(key)} />);
      await waitFor(() => expect(create).toHaveBeenCalledOnce());
      await waitFor(() =>
        expect(
          screen.getByRole("dialog").querySelector(tag)?.getAttribute("src"),
        ).toBe("blob:local-document"),
      );
      expect(create.mock.calls[0]?.[0].type).toBe(mimeType);
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Close document preview" }));
      expect(revoke).toHaveBeenCalledWith("blob:local-document");
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it.each(["docx", "constructor"])(
    "reports unsupported %s files without fetching them or sending them to external viewers",
    async (extension) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(<Harness document={file(`private/report.${extension}`)} />);
      expect(
        await screen.findByText(/Preview is not available for this file type/),
      ).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole("link", { name: "Download original" })
          .getAttribute("href"),
      ).toBe(`/api/files/download?key=private%2Freport.${extension}`);
      expect(screen.queryByTitle("PDF document preview")).toBeNull();
    },
  );

  it("reports storage errors and retries without showing fabricated content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "File no longer exists." } },
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(new Response("Recovered content"));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness document={file()} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "File no longer exists.",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry preview" }));
    expect((await screen.findByLabelText("Document content")).textContent).toBe(
      "Recovered content",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts both fetch and pending stream reads when the modal closes", async () => {
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial"));
            },
            cancel,
          }),
        );
      }),
    );
    render(<Harness document={file()} />);
    await waitFor(() => expect(signal).toBeDefined());
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Close document preview" }));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aborts an in-flight fetch when the viewer unmounts", async () => {
    let signal: AbortSignal | undefined;
    let finish: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }),
    );
    const { unmount } = render(<Harness document={file()} />);
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish?.(new Response("late content"));
    });
    expect(screen.queryByText("late content")).toBeNull();
  });

  it("does not display partial previews after exceeding an undeclared stream size", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(textPreviewLimit + 1));
              },
              cancel,
            }),
          ),
      ),
    );
    await expect(
      loadDocumentPreview(file(), new AbortController().signal),
    ).rejects.toThrow("too large to preview");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects known oversized previews before fetching and rejects binary text and fake PDFs honestly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0x00, 0x80])))
      .mockResolvedValueOnce(new Response("<html>This is not a PDF</html>"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      loadDocumentPreview(
        file("large.tsx", textPreviewLimit + 1),
        new AbortController().signal,
      ),
    ).rejects.toThrow("too large");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      loadDocumentPreview(file(), new AbortController().signal),
    ).rejects.toThrow("not supported UTF-8 or UTF-16");
    await expect(
      loadDocumentPreview(file("fake.pdf"), new AbortController().signal),
    ).rejects.toThrow("valid PDF header");
  });

  it("previews empty and UTF-16 documents without inventing content", async () => {
    renderText("empty.txt", "");
    expect(await screen.findByText("This file is empty.")).toBeTruthy();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(new Uint8Array([255, 254, 72, 0, 105, 0])),
      ),
    );
    const preview = await loadDocumentPreview(
      file("unicode.txt"),
      new AbortController().signal,
    );
    expect(preview.kind).toBe("text");
    if (preview.kind !== "text") throw new Error("Expected text content");
    expect(preview.original).toBe("Hi");
  });

  it("reports image decoder errors while keeping the original download available", async () => {
    mockObjectUrls();
    renderText("broken.png", "invalid image");
    const image = await screen.findByRole("img", { name: "Document preview" });
    fireEvent.error(image);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "could not display this png image",
    );
    expect(
      screen.getByRole("link", { name: "Download original" }),
    ).toBeTruthy();
  });
});
