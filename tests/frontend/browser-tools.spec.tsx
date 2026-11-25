import { StrictMode } from "react";
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
import CodeFormatter from "../../src/react-app/browser-tools/tools/CodeFormatter";
import DataConverter from "../../src/react-app/browser-tools/tools/DataConverter";
import HtmlToMarkdown from "../../src/react-app/browser-tools/tools/HtmlToMarkdown";
import HtmlToJson from "../../src/react-app/browser-tools/tools/HtmlToJson";
import CryptoHasher from "../../src/react-app/browser-tools/tools/CryptoHasher";
import PdfGenerator from "../../src/react-app/browser-tools/tools/PdfGenerator";
import ThemeDesigner from "../../src/react-app/browser-tools/tools/ThemeDesigner";
import ImageConverter from "../../src/react-app/browser-tools/tools/ImageConverter";
import {
  csvToJson,
  jsonToCsv,
} from "../../src/react-app/browser-tools/tools/DataConverter.logic";
import {
  decodeBase64,
  encodeBase64,
  hashBytes,
} from "../../src/react-app/browser-tools/tools/CryptoHasher.logic";
import { convertImage } from "../../src/react-app/browser-tools/tools/ImageConverter.logic";
import {
  generatePublication,
  defaultSettings,
} from "../../src/react-app/browser-tools/tools/PublicationDesigner.logic";
import { publicationTemplates } from "../../src/react-app/browser-tools/publisher/publicationTemplates";
import { useToolOperation } from "../../src/react-app/browser-tools/useToolOperation";
import {
  BlobPreview,
  OutputActions,
} from "../../src/react-app/browser-tools/components/ToolPanel";

async function selectOption(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: new RegExp(`${label}$`) }),
  );
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("browser tools", () => {
  it("opens all nine real tools from the application and filters the catalog without requests", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ id: "access:test", name: "selected@example.com" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/browser-tools");
    const { default: App } = await import("../../src/react-app/App");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Available tools (9)" }),
    ).toBeTruthy();
    const search = screen.getByRole("searchbox", { name: "Search tools" });
    fireEvent.change(search, { target: { value: "sha256" } });
    expect(
      screen.getByRole("heading", { name: "Available tools (1)" }),
    ).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    const user = userEvent.setup();
    const nav = screen.getByRole("navigation", { name: "Browser tools" });
    const main = within(screen.getByRole("main"));
    for (const name of [
      "Code Formatter",
      "HTML to Markdown",
      "HTML to JSON",
      "PDF Generator",
      "Image Converter & Resizer",
      "CSV / JSON Converter",
      "WebCrypto & Base64",
      "Fluent Theme Designer",
      "Publication Designer",
    ]) {
      await user.click(within(nav).getByRole("link", { name }));
      await main.findByRole(
        "heading",
        {
          name: name === "Publication Designer" ? "Publisher" : name,
        },
        { timeout: 10000 },
      );
      expect(screen.queryByRole("alert")).toBeNull();
    }
    const toolCalls = fetchMock.mock.calls.filter(
      ([url]) => !["/api/auth/status", "/api/auth/config", "/api/conversations"].includes(String(url)),
    );
    expect(toolCalls).toEqual([]);
  }, 120000);

  it("keeps publication menus open during selection and confirms discarding unsaved drafts", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ id: "access:test", name: "selected@example.com" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(
      null,
      "",
      "/browser-tools/publication-designer",
    );
    const { default: App } = await import("../../src/react-app/App");
    render(<App />);
    const user = userEvent.setup();
    const nav = screen.getByRole("navigation", { name: "Browser tools" });
    await user.click(
      within(nav).getByRole("link", { name: "Publication Designer" }),
    );
    await within(screen.getByRole("main")).findByRole(
      "heading",
      { name: "Publisher" },
      { timeout: 10000 },
    );
    await user.click(
      screen.getByRole("button", { name: "Create blank publication" }),
    );
    await within(screen.getByRole("main")).findByRole(
      "textbox",
      { name: "Publication content" },
      { timeout: 30000 },
    );
    await user.click(screen.getByRole("button", { name: "Page layout" }));
    await selectOption("Paper size", "A5");
    expect(
      screen.getByRole("button", { name: /Paper size$/ }).textContent,
    ).toContain("A5");
    expect(screen.getByRole("dialog", { name: "Page layout" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close settings" }));
    await user.click(within(nav).getByRole("link", { name: "All tools" }));
    const confirm = await screen.findByRole("dialog", {
      name: "Leave Publisher?",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "Continue editing" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Publication content" }),
    ).toBeTruthy();
    await user.click(within(nav).getByRole("link", { name: "All tools" }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "Leave Publisher?" }),
      ).getByRole("button", { name: "Discard and leave" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Available tools (9)" }),
    ).toBeTruthy();
    const toolCalls = fetchMock.mock.calls.filter(
      ([url]) => !["/api/auth/status", "/api/auth/config", "/api/conversations"].includes(String(url)),
    );
    expect(toolCalls).toEqual([]);
  }, 120000);

  it("formats TypeScript with accessible selection and clears stale output on input edits", async () => {
    render(
      <StrictMode>
        <CodeFormatter />
      </StrictMode>,
    );
    await selectOption("Language", "typescript");
    fireEvent.change(screen.getByRole("textbox", { name: "Input code" }), {
      target: { value: "const count:number=1;" },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Format code" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Formatted output" }),
      ).toHaveProperty("value", "const count: number = 1;\n"),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Input code" }), {
      target: { value: "{" },
    });
    expect(
      screen.getByRole("textbox", { name: "Formatted output" }),
    ).toHaveProperty("value", "");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Format code" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unexpected token",
    );
  });

  it("converts quoted CSV through the UI and reports malformed input", async () => {
    render(<DataConverter />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Convert CSV to JSON" }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("textbox", { name: "Converted JSON" })
          .getAttribute("readonly"),
      ).not.toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Converted JSON" }),
      ).toHaveProperty("value", expect.stringContaining("Bob, Jr.")),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Input CSV" }), {
      target: { value: 'a,b\n"unfinished' },
    });
    await user.click(
      screen.getByRole("button", { name: "Convert CSV to JSON" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "was not closed",
    );
    expect(
      screen.getByRole("textbox", { name: "Converted JSON" }),
    ).toHaveProperty("value", "");
  });

  it("converts HTML as inert input without fetching resources or executing scripts", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ id: "access:test", name: "selected@example.com" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<HtmlToMarkdown />);
    fireEvent.change(screen.getByRole("textbox", { name: "HTML source" }), {
      target: {
        value:
          '<h1>Local</h1><script>fetch("/upload")</script><img src="https://example.test/private.png"><p><strong>Private</strong></p>',
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Convert to Markdown" }));
    await waitFor(() => {
      const result = (
        screen.getByRole("textbox", {
          name: "Markdown output",
        }) as HTMLTextAreaElement
      ).value;
      expect(result).toContain("# Local");
      expect(result).toContain("**Private**");
      expect(result).not.toContain("fetch");
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("img")).toBeNull();
  });

  it("converts HTML elements and attributes to JSON", async () => {
    render(<HtmlToJson />);
    fireEvent.change(screen.getByRole("textbox", { name: "HTML input" }), {
      target: {
        value:
          '<div class="card" id="promo"><h2>Welcome</h2><p>Convert <strong>HTML</strong> to JSON.</p></div>',
      },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Convert to JSON" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "JSON output" }),
      ).toHaveProperty("value", expect.stringContaining('"tag": "div"')),
    );
    expect(screen.getByRole("textbox", { name: "JSON output" })).toHaveProperty(
      "value",
      expect.stringContaining('"class": "card"'),
    );
  });

  it("encodes UTF-8 text in the UI and rejects invalid Base64", async () => {
    render(<CryptoHasher />);
    await selectOption("Operation", "Base64 encode");
    fireEvent.change(screen.getByRole("textbox", { name: "Input string" }), {
      target: { value: "Hello 世界" },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Run text operation" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Result" })).toHaveProperty(
        "value",
        encodeBase64("Hello 世界"),
      ),
    );
    await selectOption("Operation", "Base64 decode");
    fireEvent.change(screen.getByRole("textbox", { name: "Input string" }), {
      target: { value: "%%%=" },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Run text operation" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "valid padded Base64",
    );
  });

  it("generates a local PDF preview and revokes its URL when the input changes", async () => {
    const create = vi.fn(() => "blob:local-pdf");
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    render(<PdfGenerator />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Generate PDF" }));
    expect(await screen.findByTitle("Generated PDF preview")).toHaveProperty(
      "src",
      "blob:local-pdf",
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/pdf" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Document title" }), {
      target: { value: "Changed" },
    });
    expect(revoke).toHaveBeenCalledWith("blob:local-pdf");
    fireEvent.change(screen.getByRole("textbox", { name: "Body text" }), {
      target: { value: "Unicode 世界" },
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Generate PDF" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ASCII");
  });

  it("exports all 23 Fluent slots and surfaces invalid colors", async () => {
    render(<ThemeDesigner />);
    const output = screen.getByRole("textbox", {
      name: "Exported theme",
    }) as HTMLTextAreaElement;
    expect(Object.keys(JSON.parse(output.value))).toHaveLength(23);
    await selectOption("Export format", "CSS variables");
    expect(output.value).toContain("--themePrimary: #0078d4");
    fireEvent.change(
      screen.getByRole("textbox", { name: "primary hex color" }),
      { target: { value: "invalid" } },
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "hexadecimal color",
    );
    expect(output.value).toBe("");
  });

  it("offers browser image controls and handles unsupported image files", async () => {
    const { container } = render(<ImageConverter />);
    expect(
      screen.getByRole("button", { name: "Convert image" }),
    ).toHaveProperty("disabled", true);
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    if (!fileInput) throw new Error("The local image picker is missing.");
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["text"], "notes.txt", { type: "text/plain" })],
      },
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Select an image file",
    );
  });

  it("reports clipboard permission failures explicitly", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Permission denied"),
    );
    render(<OutputActions text="private" filename="result.txt" />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "clipboard permissions",
    );
  });
});

describe("local operation regressions", () => {
  it("round-trips quoted multiline CSV with configurable delimiters and rejects mismatched rows", () => {
    const json = '[{"name":"A;B","note":"line 1\\nline 2","active":true}]';
    expect(JSON.parse(csvToJson(jsonToCsv(json, ";"), ";"))).toEqual(
      JSON.parse(json),
    );
    expect(() => csvToJson("a,b\n1", ",")).toThrow("expected 2");
    expect(() => csvToJson("a,a\n1,2", ",")).toThrow("unique");
  });

  it("hashes bytes with WebCrypto and preserves Unicode Base64 round trips", async () => {
    expect(
      await hashBytes(new TextEncoder().encode("abc").buffer, "SHA-256"),
    ).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(decodeBase64(encodeBase64("世界 🌍"))).toBe("世界 🌍");
    expect(() => decodeBase64("Zh==")).toThrow("padding bits");
  });

  it("renders every supplied publication template with physical pages and contents", () => {
    for (const template of publicationTemplates) {
      const result = generatePublication(template.content, template.settings);
      expect(result.blob.type).toBe("application/pdf");
      expect(result.blob.size).toBeGreaterThan(0);
      expect(result.pages).toBeGreaterThan(0);
      if (template.settings.includeContents)
        expect(result.headings[0]?.page).toBeGreaterThan(2);
    }
    expect(() =>
      generatePublication(
        {
          type: "doc",
          content: [
            {
              type: "image",
              attrs: { src: "https://example.test/private.png" },
            },
          ],
        },
        defaultSettings,
      ),
    ).toThrow("local PNG or JPEG");
  });

  it("encodes images on a local canvas, fills JPEG transparency and releases the canvas", async () => {
    const canvas = document.createElement("canvas");
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const context = { fillStyle: "", fillRect, drawImage };
    vi.spyOn(canvas, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) =>
      callback(new Blob(["jpeg"], { type: "image/jpeg" })),
    );
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag, options) =>
      tag === "canvas" ? canvas : createElement(tag, options),
    );
    const image = new Image();
    expect((await convertImage(image, 100, 50, "image/jpeg", 90)).type).toBe(
      "image/jpeg",
    );
    expect(fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 100, 50);
    expect(canvas.width).toBe(0);
    await expect(convertImage(image, 0, 50, "image/jpeg", 90)).rejects.toThrow(
      "positive whole",
    );
  });

  it("suppresses stale asynchronous results after clearing or unmounting", async () => {
    let resolve: (value: string) => void = () => {};
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    function Harness() {
      const operation = useToolOperation<string>();
      return (
        <>
          <button
            onClick={() =>
              void operation.run(
                () => pending,
                1,
                (value) => value.length,
              )
            }
          >
            Run
          </button>
          <button onClick={operation.clear}>Clear</button>
          <output>{operation.result ?? "empty"}</output>
        </>
      );
    }
    const { unmount } = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Run" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await act(async () => {
      resolve("stale");
      await pending;
    });
    expect(screen.getByRole("status").textContent).toBe("empty");
    unmount();
  });

  it("releases local preview URLs on unmount", () => {
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => "blob:local-image";
        static revokeObjectURL = revoke;
      },
    );
    const { unmount } = render(
      <BlobPreview
        blob={new Blob(["image"])}
        kind="image"
        label="Local preview"
      />,
    );
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:local-image");
  });
});
