import {
  Button,
  ListBoxItem,
  TextField,
  Label,
  Input,
  Toolbar,
} from "react-aria-components";
import { ToolSelect, ToolCheckbox } from "../components/ToolControls";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ButtonProps } from "react-aria-components";
import {
  ArrowLeft,
  Minus,
  Plus,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
  ImagePlus,
  PlusSquare,
  FileCog,
  PanelsTopLeft,
  TableProperties,
  Image as PictureIcon,
  Download,
  X,
  ChevronDown,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { Node } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "@tiptap/extension-table";
import { downloadBlob } from "../browserIO";
import {
  generatePublication,
  cellTextColor,
} from "./PublicationDesigner.logic";
import type { PublicationSettings } from "./PublicationDesigner.logic";
import styles from "../BrowserTools.module.css";
import publicationStyles from "./PublicationDesigner.module.css";
import { usePublisher } from "../publisher/publisherContext";
import type { PublicationDraft } from "../publisher/publisherContext";

const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-publication-page-break]" }],
  renderHTML: () => [
    "div",
    { "data-publication-page-break": "", contenteditable: "false" },
    "Page break",
  ],
});

const backgroundColor = {
  default: null,
  parseHTML: (element: HTMLElement) => {
    const saved = element.getAttribute("data-background-color");
    if (saved) return saved;
    const rgb = element.style.backgroundColor.match(
      /^rgb\((\d+), (\d+), (\d+)\)$/,
    );
    return rgb
      ? `#${rgb
          .slice(1)
          .map((value) => Number(value).toString(16).padStart(2, "0"))
          .join("")}`
      : null;
  },
  renderHTML: (attrs: Record<string, unknown>) =>
    attrs.backgroundColor
      ? {
          style: `background-color: ${attrs.backgroundColor}; color: ${/^#[0-9a-f]{6}$/i.test(String(attrs.backgroundColor)) ? cellTextColor(String(attrs.backgroundColor)) : "inherit"}`,
          "data-background-color": attrs.backgroundColor,
        }
      : {},
};

const PublicationTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      publicationStyle: {
        default: "grid",
        parseHTML: (element) =>
          element.getAttribute("data-publication-style") ?? "grid",
        renderHTML: (attrs) => ({
          "data-publication-style": attrs.publicationStyle,
        }),
      },
    };
  },
});
const PublicationImage = Image.extend({
  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (element) =>
          /^data:image\/(?:png|jpeg);base64,/.test(
            element.getAttribute("src") ?? "",
          )
            ? null
            : false,
      },
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      publicationWidth: {
        default: 100,
        parseHTML: (element) =>
          Number(element.getAttribute("data-publication-width") ?? 100),
        renderHTML: (attrs) => ({
          style: `width: ${attrs.publicationWidth}%; height: auto`,
          "data-publication-width": attrs.publicationWidth,
        }),
      },
    };
  },
}).configure({ allowBase64: true });

async function localImage(file: File) {
  if (!["image/png", "image/jpeg"].includes(file.type))
    throw new Error(
      "Choose a PNG or JPEG image. Other formats are not supported.",
    );
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not read the image."));
    reader.onerror = () =>
      reject(
        new Error("Could not read the image file. Try selecting it again."),
      );
    reader.onabort = () => reject(new Error("Image loading was cancelled."));
    reader.readAsDataURL(file);
  });
  const image = new window.Image();
  image.src = src;
  try {
    await image.decode();
  } catch {
    throw new Error(
      "Could not decode the image. Select a valid PNG or JPEG file.",
    );
  }
  if (!image.naturalWidth || !image.naturalHeight)
    throw new Error("The image has no valid dimensions.");
  return {
    type: "image",
    attrs: { src, alt: file.name, publicationWidth: 100 },
  };
}

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
    code: false,
    codeBlock: false,
    strike: false,
  }),
  TextAlign.configure({
    types: ["heading", "paragraph"],
    alignments: ["left", "center", "right"],
  }),
  PublicationTable.configure({ resizable: false }),
  TableRow,
  TableCell.extend({
    content: "paragraph+",
    addAttributes() {
      return { ...this.parent?.(), backgroundColor };
    },
  }),
  TableHeader.extend({
    content: "paragraph+",
    addAttributes() {
      return { ...this.parent?.(), backgroundColor };
    },
  }),
  PublicationImage,
  PageBreak,
];

const ribbonTabs = [
  ["insert", "Insert", PlusSquare],
  ["layout", "Page layout", PanelsTopLeft],
  ["document", "Document", FileCog],
  ["table", "Table formatting", TableProperties],
  ["picture", "Image formatting", PictureIcon],
] as const;
type RibbonTab = (typeof ribbonTabs)[number][0];
const zoomLevels = [50, 75, 100, 125, 150];

function IconButton({
  label,
  children,
  ...props
}: { label: string } & ButtonProps) {
  return (
    <Button type="button" aria-label={label} {...props}>
      {children}
    </Button>
  );
}

export default function PublicationDesigner() {
  const { draft } = usePublisher();
  return draft ? (
    <PublicationEditor draft={draft} />
  ) : (
    <Navigate to="/browser-tools/publication-designer" replace />
  );
}

function PublicationEditor({ draft }: { draft: PublicationDraft }) {
  const { updateContent, updateSettings } = usePublisher();
  const { settings, content } = draft;
  const [previewContent, setPreviewContent] = useState(content);
  const [downloadError, setDownloadError] = useState("");
  const [imageError, setImageError] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [ribbonTab, setRibbonTab] = useState<RibbonTab | null>(null);
  const [zoom, setZoom] = useState(100);
  const ribbon = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ribbonTab) return;
    document
      .getElementById(`publication-panel-${ribbonTab}`)
      ?.querySelector<HTMLElement>("input, select, button")
      ?.focus();
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof HTMLElement &&
        !event.target.closest("[data-tool-select-popover]") &&
        !ribbon.current?.contains(event.target)
      )
        setRibbonTab(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      document.getElementById(`publication-tab-${ribbonTab}`)?.focus();
      setRibbonTab(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [ribbonTab]);
  const editor = useEditor({
    extensions,
    content,
    editorProps: {
      attributes: {
        "aria-label": "Publication content",
        role: "textbox",
        "aria-multiline": "true",
      },
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (/<img\b/i.test(html)) {
          setImageError(
            "Use Insert image to add local PNG/JPEG files. Pasted web images are not loaded or exported.",
          );
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        if (
          event.dataTransfer?.files.length ||
          /<img\b/i.test(event.dataTransfer?.getData("text/html") ?? "")
        ) {
          setImageError(
            "Use Insert image to select local PNG/JPEG files; file drops are not inserted.",
          );
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => updateContent(editor.getJSON()),
  });
  const formatting = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            underline: editor.isActive("underline"),
            bulletList: editor.isActive("bulletList"),
            orderedList: editor.isActive("orderedList"),
            blockquote: editor.isActive("blockquote"),
            block:
              [1, 2, 3].find((level) =>
                editor.isActive("heading", { level }),
              ) ?? 0,
            alignment:
              ["left", "center", "right"].find((textAlign) =>
                editor.isActive({ textAlign }),
              ) ?? "left",
            undo: editor.can().undo(),
            redo: editor.can().redo(),
            table: editor.isActive("table"),
            tableStyle: String(
              editor.getAttributes("table").publicationStyle ?? "grid",
            ),
            cellFill: String(
              editor.getAttributes("tableCell").backgroundColor ??
                editor.getAttributes("tableHeader").backgroundColor ??
                "#ffffff",
            ),
            image: editor.isActive("image"),
            imageAlt: String(editor.getAttributes("image").alt ?? ""),
            imageWidth: Number(
              editor.getAttributes("image").publicationWidth ?? 100,
            ),
          }
        : null,
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewContent(content), 300);
    return () => window.clearTimeout(timer);
  }, [content]);
  const output = useMemo(() => {
    try {
      return {
        result: generatePublication(previewContent, settings),
        error: "",
      };
    } catch (error) {
      return {
        result: null,
        error:
          error instanceof Error
            ? error.message
            : "Could not generate the publication PDF.",
      };
    }
  }, [previewContent, settings]);
  const updating = content !== previewContent;
  const contentsHeadings =
    output.result?.headings.filter(
      (heading) => heading.level <= settings.contentsDepth,
    ) ?? [];
  function update(next: Partial<PublicationSettings>) {
    updateSettings(next);
    setDownloadError("");
  }
  const paper = (
    { a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4] } as const
  )[settings.format];
  const [paperWidth, paperHeight] =
    settings.orientation === "portrait"
      ? paper
      : ([paper[1], paper[0]] as const);
  const sheetStyle = {
    width: `${paperWidth}mm`,
    minHeight: `${paperHeight}mm`,
    padding: `${Number.isFinite(settings.margin) ? settings.margin : 20}mm`,
    fontFamily:
      settings.font === "times"
        ? "'Times New Roman', serif"
        : "Arial, sans-serif",
    fontSize: `${Number.isFinite(settings.fontSize) ? settings.fontSize : 11}pt`,
    lineHeight: Number.isFinite(settings.lineHeight)
      ? settings.lineHeight
      : 1.4,
    zoom: zoom / 100,
    maxWidth: `calc((100vw - 3rem) / ${zoom / 100})`,
    "--publication-content-height": `${paperHeight - (Number.isFinite(settings.margin) ? settings.margin : 20) * 2}mm`,
  };
  return (
    <section
      className={`${styles.root} ${publicationStyles.workspace}`}
      aria-label="Publication workspace"
    >
      <h1 className={publicationStyles.srOnly}>
        {settings.title || "Untitled publication"}
      </h1>
      <div ref={ribbon} className={publicationStyles.ribbon}>
        <Toolbar
          className={publicationStyles.toolbarRow}
          aria-label="Publication formatting"
        >
          <Link
            to="/browser-tools/publication-designer"
            aria-label="Back to Publisher"
            title="Back to Publisher"
          >
            <ArrowLeft />
          </Link>
          <span className={publicationStyles.divider} />
          <IconButton
            label="Zoom out"
            isDisabled={zoom === zoomLevels[0]}
            onPress={() => {
              const next = zoomLevels[zoomLevels.indexOf(zoom) - 1];
              if (next !== undefined) setZoom(next);
            }}
          >
            <Minus />
          </IconButton>
          <ToolSelect
            aria-label="View zoom"
            selectedKey={String(zoom)}
            onSelectionChange={(selectedValue) =>
              setZoom(Number(selectedValue))
            }
          >
            {zoomLevels.map((value) => (
              <ListBoxItem id={String(value)} key={value}>
                {value}%
              </ListBoxItem>
            ))}
          </ToolSelect>
          <IconButton
            label="Zoom in"
            isDisabled={zoom === zoomLevels.at(-1)}
            onPress={() => {
              const next = zoomLevels[zoomLevels.indexOf(zoom) + 1];
              if (next !== undefined) setZoom(next);
            }}
          >
            <Plus />
          </IconButton>
          <span className={publicationStyles.divider} />
          <ToolSelect
            aria-label="Text style"
            isDisabled={!editor || formatting?.table || formatting?.image}
            selectedKey={String(formatting?.block ?? 0)}
            onSelectionChange={(selectedValue) => {
              const level = Number(selectedValue);
              if (level === 1 || level === 2 || level === 3)
                editor?.chain().focus().setHeading({ level }).run();
              else editor?.chain().focus().setParagraph().run();
            }}
          >
            <ListBoxItem id={String("0")}>Text</ListBoxItem>
            <ListBoxItem id={String("1")}>Heading 1</ListBoxItem>
            <ListBoxItem id={String("2")}>Heading 2</ListBoxItem>
            <ListBoxItem id={String("3")}>Heading 3</ListBoxItem>
          </ToolSelect>
          <ToolSelect
            aria-label="Font family"
            selectedKey={String(settings.font)}
            onSelectionChange={(selectedValue) =>
              update({
                font: selectedValue as PublicationSettings["font"],
              })
            }
          >
            <ListBoxItem id={String("times")}>Times</ListBoxItem>
            <ListBoxItem id={String("helvetica")}>Helvetica</ListBoxItem>
          </ToolSelect>
          <ToolSelect
            aria-label="Body font size"
            selectedKey={String(settings.fontSize)}
            onSelectionChange={(selectedValue) =>
              update({ fontSize: Number(selectedValue) })
            }
          >
            {Array.from({ length: 8 }, (_, index) => index + 9).map((value) => (
              <ListBoxItem id={String(value)} key={value}>
                {value} pt
              </ListBoxItem>
            ))}
          </ToolSelect>
          <span className={publicationStyles.divider} />
          <IconButton
            label="Bold"
            isDisabled={!editor || formatting?.image}
            aria-pressed={formatting?.bold ?? false}
            onPress={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold />
          </IconButton>
          <IconButton
            label="Italic"
            isDisabled={!editor || formatting?.image}
            aria-pressed={formatting?.italic ?? false}
            onPress={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic />
          </IconButton>
          <IconButton
            label="Underline"
            isDisabled={!editor || formatting?.image}
            aria-pressed={formatting?.underline ?? false}
            onPress={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <Underline />
          </IconButton>
          <IconButton
            label="Bullet list"
            isDisabled={!editor || formatting?.table || formatting?.image}
            aria-pressed={formatting?.bulletList ?? false}
            onPress={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List />
          </IconButton>
          <IconButton
            label="Numbered list"
            isDisabled={!editor || formatting?.table || formatting?.image}
            aria-pressed={formatting?.orderedList ?? false}
            onPress={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered />
          </IconButton>
          <IconButton
            label="Quote"
            isDisabled={!editor || formatting?.table || formatting?.image}
            aria-pressed={formatting?.blockquote ?? false}
            onPress={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote />
          </IconButton>
          <ToolSelect
            aria-label="Alignment"
            isDisabled={!editor || formatting?.image}
            selectedKey={String(formatting?.alignment ?? "left")}
            onSelectionChange={(selectedValue) =>
              editor?.chain().focus().setTextAlign(selectedValue).run()
            }
          >
            <ListBoxItem id={String("left")}>Left</ListBoxItem>
            <ListBoxItem id={String("center")}>Center</ListBoxItem>
            <ListBoxItem id={String("right")}>Right</ListBoxItem>
          </ToolSelect>
          <span className={publicationStyles.divider} />
          <IconButton
            label="Insert image"
            isDisabled={!editor || imageBusy || formatting?.table}
            onPress={() => fileInput.current?.click()}
          >
            <ImagePlus />
          </IconButton>
          {ribbonTabs.map(([id, label, Icon]) => (
            <IconButton
              key={id}
              id={`publication-tab-${id}`}
              label={label}
              aria-haspopup="dialog"
              aria-expanded={ribbonTab === id}
              aria-controls="publication-options"
              onPress={() => setRibbonTab(ribbonTab === id ? null : id)}
            >
              <Icon />
              <ChevronDown className={publicationStyles.chevron} />
            </IconButton>
          ))}
          <span className={publicationStyles.divider} />
          <IconButton
            label="Undo"
            isDisabled={!formatting?.undo}
            onPress={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 />
          </IconButton>
          <IconButton
            label="Redo"
            isDisabled={!formatting?.redo}
            onPress={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 />
          </IconButton>
          <p
            role="status"
            aria-live="polite"
            className={publicationStyles.status}
          >
            {imageBusy
              ? "Loading image..."
              : updating
                ? "Updating PDF..."
                : output.result
                  ? `${output.result.pages} ${output.result.pages === 1 ? "page" : "pages"}`
                  : "PDF error"}
          </p>
          <IconButton
            label="Download PDF"
            isDisabled={!output.result || updating || imageBusy}
            onPress={() => {
              if (!output.result || updating || imageBusy) return;
              try {
                downloadBlob(
                  output.result.blob,
                  `${
                    settings.title
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "") || "publication"
                  }.pdf`,
                );
              } catch {
                setDownloadError(
                  "Could not download. Check browser download permissions.",
                );
              }
            }}
          >
            <Download />
          </IconButton>
        </Toolbar>
        <div
          id="publication-options"
          className={publicationStyles.options}
          role="dialog"
          aria-label={
            ribbonTabs.find(([id]) => id === ribbonTab)?.[1] ??
            "Publication options"
          }
          hidden={!ribbonTab}
        >
          <div className={publicationStyles.optionsHeader}>
            <strong>{ribbonTabs.find(([id]) => id === ribbonTab)?.[1]}</strong>
            <IconButton
              label="Close settings"
              onPress={() => {
                document
                  .getElementById(`publication-tab-${ribbonTab}`)
                  ?.focus();
                setRibbonTab(null);
              }}
            >
              <X />
            </IconButton>
          </div>
          <div
            className={styles.toolbar}
            id="publication-panel-document"
            role="group"
            aria-labelledby="publication-tab-document"
            hidden={ribbonTab !== "document"}
          >
            <TextField
              value={settings.title}
              onChange={(selectedValue) => update({ title: selectedValue })}
            >
              <Label>
                <>Publication title</>
              </Label>
              <Input />
            </TextField>
            <TextField
              value={settings.author}
              onChange={(selectedValue) => update({ author: selectedValue })}
            >
              <Label>
                <>Author / cover byline</>
              </Label>
              <Input />
            </TextField>
          </div>
          <fieldset
            className={publicationStyles.settings}
            id="publication-panel-layout"
            role="group"
            aria-labelledby="publication-tab-layout"
            hidden={ribbonTab !== "layout"}
          >
            <legend>Page layout</legend>
            <div className={styles.toolbar}>
              <ToolSelect
                selectedKey={String(settings.format)}
                onSelectionChange={(selectedValue) =>
                  update({
                    format: selectedValue as PublicationSettings["format"],
                  })
                }
                label={<>Paper size</>}
              >
                <ListBoxItem id={String("a4")}>A4</ListBoxItem>
                <ListBoxItem id={String("a5")}>A5</ListBoxItem>
                <ListBoxItem id={String("letter")}>US Letter</ListBoxItem>
              </ToolSelect>
              <ToolSelect
                selectedKey={String(settings.orientation)}
                onSelectionChange={(selectedValue) =>
                  update({
                    orientation:
                      selectedValue as PublicationSettings["orientation"],
                  })
                }
                label={<>Orientation</>}
              >
                <ListBoxItem id={String("portrait")}>Portrait</ListBoxItem>
                <ListBoxItem id={String("landscape")}>Landscape</ListBoxItem>
              </ToolSelect>
              <label>
                Margins (mm)
                <input
                  type="number"
                  min="10"
                  max="30"
                  value={
                    Number.isFinite(settings.margin) ? settings.margin : ""
                  }
                  onChange={(event) =>
                    update({ margin: event.target.valueAsNumber })
                  }
                />
              </label>
              <ToolSelect
                selectedKey={String(settings.columns)}
                onSelectionChange={(selectedValue) =>
                  update({ columns: selectedValue === "2" ? 2 : 1 })
                }
                label={<>Columns</>}
              >
                <ListBoxItem id={String("1")}>One column</ListBoxItem>
                <ListBoxItem id={String("2")}>Two columns</ListBoxItem>
              </ToolSelect>
              <ToolSelect
                selectedKey={String(settings.font)}
                onSelectionChange={(selectedValue) =>
                  update({
                    font: selectedValue === "helvetica" ? "helvetica" : "times",
                  })
                }
                label={<>Typeface</>}
              >
                <ListBoxItem id={String("times")}>Serif (Times)</ListBoxItem>
                <ListBoxItem id={String("helvetica")}>
                  Sans serif (Helvetica)
                </ListBoxItem>
              </ToolSelect>
              <label>
                Body size (pt)
                <input
                  type="number"
                  min="9"
                  max="16"
                  value={
                    Number.isFinite(settings.fontSize) ? settings.fontSize : ""
                  }
                  onChange={(event) =>
                    update({ fontSize: event.target.valueAsNumber })
                  }
                />
              </label>
              <label>
                Line spacing
                <input
                  type="number"
                  min="1.1"
                  max="1.8"
                  step="0.1"
                  value={
                    Number.isFinite(settings.lineHeight)
                      ? settings.lineHeight
                      : ""
                  }
                  onChange={(event) =>
                    update({ lineHeight: event.target.valueAsNumber })
                  }
                />
              </label>
              <ToolCheckbox
                className={styles.checkbox}
                isSelected={settings.runningHeader}
                onChange={(selected) => update({ runningHeader: selected })}
              >
                <>Running title</>
              </ToolCheckbox>
              <ToolCheckbox
                className={styles.checkbox}
                isSelected={settings.pageNumbers}
                onChange={(selected) => update({ pageNumbers: selected })}
              >
                <>Page numbers</>
              </ToolCheckbox>
            </div>
          </fieldset>
          <fieldset
            className={publicationStyles.settings}
            id="publication-panel-insert"
            role="group"
            aria-labelledby="publication-tab-insert"
            hidden={ribbonTab !== "insert"}
          >
            <legend>Cover &amp; contents</legend>
            <div className={styles.toolbar}>
              <Button
                isDisabled={!editor || formatting?.table}
                onPress={() =>
                  editor?.chain().focus().setHorizontalRule().run()
                }
              >
                Divider
              </Button>
              <Button
                isDisabled={!editor || formatting?.table}
                onPress={() =>
                  editor
                    ?.chain()
                    .focus()
                    .insertContent({ type: "pageBreak" })
                    .run()
                }
              >
                Page break
              </Button>
              <Button
                isDisabled={!editor || formatting?.table}
                onPress={() => {
                  editor
                    ?.chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run();
                  setRibbonTab("table");
                }}
              >
                Insert table
              </Button>
              <Button
                isDisabled={!editor || imageBusy || formatting?.table}
                onPress={() => fileInput.current?.click()}
              >
                {imageBusy ? "Loading image..." : "Insert image"}
              </Button>
              <ToolSelect
                selectedKey={String(settings.cover)}
                onSelectionChange={(selectedValue) =>
                  update({
                    cover: selectedValue as PublicationSettings["cover"],
                  })
                }
                label={<>Cover template</>}
              >
                <ListBoxItem id={String("none")}>No cover</ListBoxItem>
                <ListBoxItem id={String("editorial")}>Editorial</ListBoxItem>
                <ListBoxItem id={String("minimal")}>Minimal</ListBoxItem>
                <ListBoxItem id={String("report")}>Report</ListBoxItem>
              </ToolSelect>
              <TextField
                value={settings.coverKicker}
                onChange={(selectedValue) =>
                  update({ coverKicker: selectedValue })
                }
              >
                <Label>
                  <>Cover edition label</>
                </Label>
                <Input />
              </TextField>
              <TextField
                value={settings.coverSubtitle}
                onChange={(selectedValue) =>
                  update({ coverSubtitle: selectedValue })
                }
              >
                <Label>
                  <>Cover subtitle</>
                </Label>
                <Input />
              </TextField>
              <ToolCheckbox
                className={styles.checkbox}
                isSelected={settings.includeContents}
                onChange={(selected) => update({ includeContents: selected })}
              >
                <>Table of contents</>
              </ToolCheckbox>
              <ToolSelect
                selectedKey={String(settings.contentsDepth)}
                onSelectionChange={(selectedValue) =>
                  update({
                    contentsDepth: Number(
                      selectedValue,
                    ) as PublicationSettings["contentsDepth"],
                  })
                }
                label={<>Contents heading depth</>}
              >
                <ListBoxItem id={String("1")}>Heading 1</ListBoxItem>
                <ListBoxItem id={String("2")}>Headings 1-2</ListBoxItem>
                <ListBoxItem id={String("3")}>Headings 1-3</ListBoxItem>
              </ToolSelect>
            </div>
            <p className={styles.note}>
              Cover title and byline use the publication title and author above.
              Every field remains editable; changing templates never replaces
              the body. Contents are generated from headings, with physical PDF
              page numbers including the cover and contents pages.
            </p>
          </fieldset>
          {editor && formatting && (
            <>
              <div
                id="publication-panel-table"
                role="group"
                aria-labelledby="publication-tab-table"
                hidden={ribbonTab !== "table"}
              >
                {!formatting.table && (
                  <p>
                    Select a table cell in the document to use these controls.
                  </p>
                )}
                <fieldset
                  disabled={!formatting.table}
                  className={publicationStyles.formatting}
                >
                  <legend>Table formatting</legend>
                  <ToolSelect
                    selectedKey={String(formatting.tableStyle)}
                    onSelectionChange={(selectedValue) =>
                      editor
                        .chain()
                        .focus()
                        .updateAttributes("table", {
                          publicationStyle: selectedValue,
                        })
                        .run()
                    }
                    label={<>Table style</>}
                  >
                    <ListBoxItem id={String("grid")}>Grid</ListBoxItem>
                    <ListBoxItem id={String("striped")}>
                      Striped rows
                    </ListBoxItem>
                    <ListBoxItem id={String("minimal")}>
                      Minimal rules
                    </ListBoxItem>
                  </ToolSelect>
                  <label>
                    Cell background
                    <input
                      type="color"
                      value={formatting.cellFill}
                      onChange={(event) =>
                        editor
                          .chain()
                          .focus()
                          .setCellAttribute(
                            "backgroundColor",
                            event.target.value,
                          )
                          .run()
                      }
                    />
                  </label>
                  <Button
                    onPress={() =>
                      editor
                        .chain()
                        .focus()
                        .setCellAttribute("backgroundColor", null)
                        .run()
                    }
                  >
                    Clear cell fill
                  </Button>
                  <Button
                    onPress={() =>
                      editor.chain().focus().toggleHeaderRow().run()
                    }
                  >
                    Toggle header row
                  </Button>
                  <Button
                    onPress={() => editor.chain().focus().addRowAfter().run()}
                  >
                    Add row
                  </Button>
                  <Button
                    onPress={() => editor.chain().focus().deleteRow().run()}
                  >
                    Delete row
                  </Button>
                  <Button
                    onPress={() =>
                      editor.chain().focus().addColumnAfter().run()
                    }
                  >
                    Add column
                  </Button>
                  <Button
                    onPress={() => editor.chain().focus().deleteColumn().run()}
                  >
                    Delete column
                  </Button>
                  <Button
                    onPress={() => editor.chain().focus().deleteTable().run()}
                  >
                    Delete table
                  </Button>
                </fieldset>
              </div>
              <div
                id="publication-panel-picture"
                role="group"
                aria-labelledby="publication-tab-picture"
                hidden={ribbonTab !== "picture"}
              >
                {!formatting.image && (
                  <p>Select an image in the document to use these controls.</p>
                )}
                <fieldset
                  disabled={!formatting.image}
                  className={publicationStyles.formatting}
                >
                  <legend>Image formatting</legend>
                  <TextField
                    value={formatting.imageAlt}
                    onChange={(selectedValue) =>
                      editor.commands.updateAttributes("image", {
                        alt: selectedValue,
                      })
                    }
                  >
                    <Label>
                      <>Image description</>
                    </Label>
                    <Input />
                  </TextField>
                  <ToolSelect
                    selectedKey={String(formatting.imageWidth)}
                    onSelectionChange={(selectedValue) =>
                      editor.commands.updateAttributes("image", {
                        publicationWidth: Number(selectedValue),
                      })
                    }
                    label={<>Image width</>}
                  >
                    <ListBoxItem id={String("25")}>25% of column</ListBoxItem>
                    <ListBoxItem id={String("50")}>50% of column</ListBoxItem>
                    <ListBoxItem id={String("75")}>75% of column</ListBoxItem>
                    <ListBoxItem id={String("100")}>Full column</ListBoxItem>
                  </ToolSelect>
                  <Button
                    onPress={() =>
                      editor.chain().focus().deleteSelection().run()
                    }
                  >
                    Remove image
                  </Button>
                </fieldset>
              </div>
            </>
          )}
        </div>
      </div>
      {(output.error || imageError || downloadError) && (
        <p
          className={`${styles.error} ${publicationStyles.error}`}
          role="alert"
        >
          {output.error || imageError || downloadError}
        </p>
      )}
      <div className={publicationStyles.editorScroll}>
        <input
          ref={fileInput}
          className={publicationStyles.fileInput}
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Choose publication image"
          disabled={imageBusy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file || !editor) return;
            setImageBusy(true);
            setImageError("");
            try {
              const image = await localImage(file);
              if (editor.isDestroyed) return;
              editor.chain().focus().insertContent(image).run();
              setRibbonTab("picture");
            } catch (error) {
              setImageError(
                error instanceof Error
                  ? error.message
                  : "Could not insert this image.",
              );
            } finally {
              setImageBusy(false);
            }
          }}
        />
        {imageError && (
          <Button onPress={() => setImageError("")}>Dismiss image error</Button>
        )}
        <section
          className={publicationStyles.canvas}
          aria-label="Publication editor"
        >
          {settings.cover !== "none" && (
            <section
              aria-label="Publication cover"
              className={`${publicationStyles.sheet} ${publicationStyles.cover} ${publicationStyles[settings.cover]}`}
              style={sheetStyle}
            >
              <p>{settings.coverKicker}</p>
              <h1>{settings.title}</h1>
              <p>{settings.coverSubtitle}</p>
              <p>{settings.author}</p>
            </section>
          )}
          {settings.includeContents && (
            <section
              aria-label="Generated table of contents"
              className={publicationStyles.sheet}
              style={sheetStyle}
            >
              <h1>Contents</h1>
              {output.result ? (
                <ol className={publicationStyles.contents}>
                  {contentsHeadings.map((heading, index) => (
                    <li
                      key={index}
                      style={{ paddingLeft: `${(heading.level - 1) * 12}pt` }}
                    >
                      <span>{heading.title || "(Untitled heading)"}</span>
                      <span>{heading.page}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>Fix the PDF error to update contents.</p>
              )}
              {output.result && contentsHeadings.length === 0 && (
                <p>Add headings to your document to populate this page.</p>
              )}
            </section>
          )}
          <EditorContent
            editor={editor}
            className={`${publicationStyles.sheet} ${publicationStyles.editor}`}
            style={{
              ...sheetStyle,
              columnCount: settings.columns,
              columnGap: "18pt",
            }}
          />
        </section>
        <p className={styles.note}>
          This centered canvas is a continuous editing view, not an exact PDF
          pagination preview. PDF output uses the selected paper and margins,
          with measured text and physical page numbers. Small screens reflow the
          canvas for editing. A page break skips remaining columns and starts a
          new physical page. Lists use a print-safe hyphen marker. Table cells
          support paragraph text, inline formatting, alignment and backgrounds.
          Rows stay together and header rows repeat when a table continues.
          Images scale proportionally to fit a column.
        </p>
        <p className={styles.note}>
          Download PDF produces selectable vector text and embeds local images.
          Print the PDF at actual size. No bleed, crop marks, custom fonts,
          links, automatic hyphenation or full widow/orphan control.
        </p>
        <p className={styles.notice}>
          Your draft is retained when you return to Publisher, but only in this
          tab. Download before refreshing or leaving Publisher. View zoom does
          not change PDF size. Font and body size apply to the whole
          publication. Text supports basic Latin (ASCII); local PNG/JPEG images
          and paragraph-based tables are supported. Remote images, merged cells
          and embeds are not.
        </p>
      </div>
    </section>
  );
}
