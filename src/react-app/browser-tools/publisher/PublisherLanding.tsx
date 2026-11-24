import { Button, TextField, Label, Input } from "react-aria-components";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, Plus } from "lucide-react";
import {
  filterPublicationTemplates,
  publicationTemplates,
} from "./publicationTemplates";
import type { PublicationTemplate } from "./publicationTemplates";
import { usePublisher } from "./publisherContext";
import toolsStyles from "../BrowserTools.module.css";
import styles from "./PublisherLanding.module.css";

const categories = [
  "All",
  ...new Set(
    publicationTemplates
      .filter((template) => template.id !== "blank")
      .map((template) => template.category),
  ),
];

export default function PublisherLanding() {
  const { draft, startTemplate } = usePublisher();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const visible = filterPublicationTemplates(query, category);
  function create(template: PublicationTemplate) {
    if (
      draft?.modified &&
      !window.confirm(
        "Start a new publication? This replaces your current in-tab draft. Cancel to continue editing and download it first.",
      )
    )
      return;
    startTemplate(template);
    navigate("/browser-tools/publication-designer/editor");
  }
  return (
    <section
      className={`${toolsStyles.root} ${styles.landing}`}
      aria-labelledby="publisher-title"
    >
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>PRINT &amp; PUBLICATIONS</p>
          <h1 id="publisher-title">Publisher</h1>
          <p>
            Create a newsletter, report or guide. Make it your own, then
            download a PDF.
          </p>
        </div>
        <BookOpen size={64} strokeWidth={1} aria-hidden="true" />
      </header>
      <div className={styles.start}>
        <Button onPress={() => create(publicationTemplates[0])}>
          <Plus size={19} aria-hidden="true" />
          Create blank publication
        </Button>
        <span>Private to this tab. No uploads, account or cloud storage.</span>
      </div>
      {draft && (
        <section
          className={styles.resume}
          aria-labelledby="current-publication"
        >
          <div>
            <h2 id="current-publication">Jump back in</h2>
            <p>{draft.settings.title || "Untitled publication"}</p>
            <small>
              Your current in-tab draft is retained while you browse templates.
            </small>
          </div>
          <Link to="/browser-tools/publication-designer/editor">
            Continue editing <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      )}
      <section aria-labelledby="template-gallery">
        <div className={styles.galleryHeader}>
          <h2 id="template-gallery">Create with a template</h2>
          <TextField
            value={query}
            onChange={(selectedValue) => setQuery(selectedValue)}
          >
            <Label>
              <>Search templates</>
            </Label>
            <Input
              type="search"
              placeholder="Search newsletters, reports, guides..."
            />
          </TextField>
        </div>
        <div
          className={styles.filters}
          role="group"
          aria-label="Template categories"
        >
          {categories.map((value) => (
            <Button
              key={value}
              aria-pressed={category === value}
              onPress={() => setCategory(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <p className={toolsStyles.note} role="status">
          {visible.length} {visible.length === 1 ? "template" : "templates"}
        </p>
        <div className={styles.gallery}>
          {visible.map((template) => (
            <Button
              key={template.id}
              className={styles.template}
              onPress={() => create(template)}
            >
              <span
                className={`${styles.preview} ${styles[template.settings.cover] ?? ""}`}
                aria-hidden="true"
              >
                <span className={styles.paper}>
                  <small>{template.settings.coverKicker}</small>
                  <strong>{template.settings.title}</strong>
                  <span>{template.settings.coverSubtitle}</span>
                  <span className={styles.lines} />
                </span>
              </span>
              <span className={styles.templateInfo}>
                <small>{template.category}</small>
                <strong>{template.name}</strong>
                <span>{template.description}</span>
              </span>
            </Button>
          ))}
        </div>
        {!visible.length && (
          <p>No templates match. Change the category or clear your search.</p>
        )}
      </section>
      <p className={toolsStyles.note}>
        Templates are starting points, not locked designs. Edit every heading,
        paragraph and table in the full-screen workspace. Basic Latin text,
        local PNG/JPEG images and direct PDF downloads are supported. Refreshing
        or leaving Publisher discards the in-tab draft; download your work
        first.
      </p>
    </section>
  );
}
