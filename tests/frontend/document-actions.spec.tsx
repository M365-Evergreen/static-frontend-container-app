import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentActions } from "../../src/react-app/pages/DocumentsPage/DocumentActions";
import { DocumentsPage } from "../../src/react-app/pages/DocumentsPage/DocumentsPage";

const uploaded = "2026-11-25T12:00:00Z";
function saved(key: string) {
  return Response.json({ file: { key, size: 0, uploaded } }, { status: 201 });
}
function conflict(etag: string) {
  return Response.json(
    { error: { message: "A file with this path already exists.", etag } },
    { status: 409 },
  );
}
async function openActions(folder = "") {
  const onChanged = vi.fn();
  const view = render(
    <DocumentActions folder={folder} onChanged={onChanged} />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Create or upload" }));
  return { ...view, onChanged, user };
}
async function newTextFile() {
  const controls = await openActions("reports/");
  await controls.user.click(
    screen.getByRole("button", { name: /^Create file/ }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "File name" }), {
    target: { value: "notes.md" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "File content" }), {
    target: { value: "# Notes\nOriginal content\n" },
  });
  await controls.user.click(screen.getByRole("button", { name: "Save file" }));
  return controls;
}
function fileInput(directory = false): HTMLInputElement {
  const input = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ].find((element) => element.hasAttribute("webkitdirectory") === directory);
  if (!input) throw new Error("Missing file picker");
  return input;
}
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("bucket creation and uploads", () => {
  it("creates an edited text file with its destination, exact content and media type, then refreshes", async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () => saved("reports/notes.md"));
    vi.stubGlobal("fetch", fetchMock);
    const { onChanged } = await newTextFile();
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("Missing file upload");
    const [url, options] = call;
    expect(url).toBe("/api/files/upload?key=reports%2Fnotes.md");
    expect(options.method).toBe("PUT");
    expect(new Headers(options.headers).get("If-Match")).toBeNull();
    expect(new Headers(options.headers).get("Content-Type")).toBe(
      "text/markdown;charset=utf-8",
    );
    if (!(options.body instanceof Blob))
      throw new Error("The upload must contain a Blob");
    expect(await blobText(options.body)).toBe("# Notes\nOriginal content\n");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Saved 1 item.")).toBeTruthy();
  });

  it("requires a fresh confirmation for each changed ETag before replacing content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(conflict('"original"'))
      .mockResolvedValueOnce(conflict('"changed"'))
      .mockResolvedValueOnce(saved("reports/notes.md"));
    vi.stubGlobal("fetch", fetchMock);
    await newTextFile();
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Replace existing file?" });
    expect(
      screen.getByRole("alertdialog", { name: "Replace existing file?" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Replace file" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByRole("button", { name: "Replace file" });
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1].headers).get("If-Match"),
    ).toBe('"original"');
    expect(screen.queryByText("Saved 1 item.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Replace file" }));
    await screen.findByText("Saved 1 item.");
    expect(
      new Headers(fetchMock.mock.calls[2]?.[1].headers).get("If-Match"),
    ).toBe('"changed"');
  });

  it("keeps the existing file without replacing it when confirmation is declined", async () => {
    const fetchMock = vi.fn(async () => conflict('"existing"'));
    vi.stubGlobal("fetch", fetchMock);
    await newTextFile();
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Keep existing file" }));
    await screen.findByText("Saved 0 items; kept 1 existing file.");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      screen
        .getByRole("textbox", { name: "File content" })
        .getAttribute("disabled"),
    ).toBeNull();
  });

  it("creates persistent folders without a file body", async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () => saved("reports/empty/"));
    vi.stubGlobal("fetch", fetchMock);
    const { user, onChanged } = await openActions("reports/");
    await user.click(screen.getByRole("button", { name: /^Create folder/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), {
      target: { value: "empty" },
    });
    await user.click(screen.getByRole("button", { name: "Create folder" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/folder?key=reports%2Fempty%2F",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it.each([false, true])(
    "uploads multiple files unchanged and preserves folder paths (directory: %s)",
    async (directory) => {
      const first = new File(["first content"], "first.txt", {
        type: "text/plain",
      });
      const second = new File([new Uint8Array([0, 127, 255])], "second.bin");
      if (directory) {
        Object.defineProperty(first, "webkitRelativePath", {
          value: "source/first.txt",
        });
        Object.defineProperty(second, "webkitRelativePath", {
          value: "source/nested/second.bin",
        });
      }
      const fetchMock = vi.fn<
        (url: string, init: RequestInit) => Promise<Response>
      >(async (url) =>
        saved(new URL(url, "https://app.test").searchParams.get("key") ?? ""),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { user, onChanged } = await openActions("destination/");
      await user.upload(fileInput(directory), [first, second]);
      await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
      const calls = fetchMock.mock.calls;
      expect(
        calls.map(([url]) =>
          new URL(url, "https://app.test").searchParams.get("key"),
        ),
      ).toEqual(
        directory
          ? [
              "destination/source/first.txt",
              "destination/source/nested/second.bin",
            ]
          : ["destination/first.txt", "destination/second.bin"],
      );
      expect(calls[0]?.[1].body).toBe(first);
      expect(calls[1]?.[1].body).toBe(second);
      expect(screen.getByText("Saved 2 items.")).toBeTruthy();
    },
  );

  it("reports partial failures, stops the batch and refreshes the real bucket", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(saved("first.txt"))
      .mockResolvedValueOnce(
        Response.json({ error: { message: "Bucket full." } }, { status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { user, onChanged } = await openActions();
    await user.upload(
      fileInput(),
      ["first.txt", "second.txt", "third.txt"].map(
        (name) => new File(["x"], name),
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "1 of 3 items saved. Bucket full.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("cancels while awaiting confirmation and does not submit the replacement or later files", async () => {
    const fetchMock = vi.fn(async () => conflict('"existing"'));
    vi.stubGlobal("fetch", fetchMock);
    const { user } = await openActions();
    await user.upload(fileInput(), [
      new File(["x"], "first.txt"),
      new File(["y"], "second.txt"),
    ]);
    await user.click(
      await screen.findByRole("button", { name: "Cancel upload" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Upload cancelled.",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("heading", { name: "Replace existing file?" }),
    ).toBeNull();
  });

  it("aborts an active upload on unmount", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal?.reason), {
            once: true,
          }),
        );
      }),
    );
    const { user, unmount } = await openActions();
    await user.upload(fileInput(), new File(["x"], "first.txt"));
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("rejects unsafe destination paths before sending any bytes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { user } = await openActions("../outside");
    await user.upload(fileInput(), new File(["x"], "first.txt"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "path segments",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("browses empty folder markers without counting or downloading them as files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          files: [
            { key: "empty/", size: 0, uploaded },
            { key: "reports/nested/file.txt", size: 5, uploaded },
          ],
          nextCursor: null,
        }),
      ),
    );
    render(<DocumentsPage />);
    const user = userEvent.setup();
    const folders = await screen.findByRole("region", { name: "Folders" });
    expect(screen.getByRole("radio", { name: "All files (1)" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download empty/" })).toBeNull();
    await user.click(within(folders).getByRole("button", { name: "empty" }));
    expect(screen.getByRole("radio", { name: "All files (0)" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create or upload" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Destination folder",
        }) as HTMLInputElement
      ).value,
    ).toBe("empty/");
    await user.click(
      screen.getByRole("button", { name: "Close create or upload" }),
    );
    await user.click(
      within(
        screen.getByRole("navigation", { name: "Bucket folders" }),
      ).getByRole("link", { name: "All files" }),
    );
    await user.click(screen.getByRole("button", { name: "reports" }));
    await user.click(screen.getByRole("button", { name: "nested" }));
    expect(screen.getByRole("grid").textContent).toContain("file.txt");
  });
});
