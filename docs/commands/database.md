**Good news: the plumbing already exists — `paulibaby-agent` has this database bound as `DB`, and the database is completely empty (0 tables), so nothing to migrate around.** I started creating the schema but you declined the write, so here's the design and the exact DDL to apply.

## What's already in place

| Item | Value |
|---|---|
| Database | `paulibaby-agent` (`e33c33ce-55ad-49b4-8d89-02e1718d1d03`), region OC, 12 KB, 0 tables |
| Worker binding | `DB` → this database ✅ |
| Other bindings | `AGENT_CONTAINER` (Durable Object + container), `AI`, `ASSETS`, `R2`, `KNOWLEDGE_MCP_URL`, `LLM_*` |

That container binding matters: D1 should be the **catalogue**, and the container is what actually *runs* the PowerShell/Python. Keep those two roles separate.

## Schema

Paste into the [D1 console](https://dash.cloudflare.com/9563d1b7d90e2bb8e1eaafd6abd8e6a8/workers/d1/databases/e33c33ce-55ad-49b4-8d89-02e1718d1d03/console) (or `wrangler d1 execute paulibaby-agent --remote --file=schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,                          -- crypto.randomUUID()
  slug TEXT NOT NULL UNIQUE,                    -- stable handle the agent/editor calls
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL CHECK (language IN ('powershell','python')),
  shell TEXT NOT NULL DEFAULT '',               -- 'pwsh' | 'powershell' | 'python3'
  code TEXT NOT NULL,
  parameters TEXT NOT NULL DEFAULT '[]',        -- JSON Schema array -> agent tool args
  tags TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low','medium','high')),
  requires_approval INTEGER NOT NULL DEFAULT 0,
  timeout_seconds INTEGER NOT NULL DEFAULT 60,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','deprecated')),
  owner TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_commands_language_status ON commands (language, status);

CREATE TABLE IF NOT EXISTS command_tags (
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (command_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_command_tags_tag ON command_tags (tag);

CREATE TABLE IF NOT EXISTS command_versions (
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  code TEXT NOT NULL,
  parameters TEXT NOT NULL DEFAULT '[]',
  change_note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (command_id, version)
);

CREATE TABLE IF NOT EXISTS command_runs (
  id TEXT PRIMARY KEY,
  command_id TEXT REFERENCES commands(id) ON DELETE SET NULL,
  command_slug TEXT NOT NULL,
  version INTEGER,
  language TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT,
  source TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent','editor','api','cli')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','running','succeeded','failed','denied','timeout')),
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  duration_ms INTEGER,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_command_runs_command ON command_runs (command_id, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS commands_fts USING fts5(
  title, description, code, tags,
  content='commands', content_rowid='rowid', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS commands_ai AFTER INSERT ON commands BEGIN
  INSERT INTO commands_fts(rowid,title,description,code,tags)
  VALUES (new.rowid,new.title,new.description,new.code,new.tags);
END;
CREATE TRIGGER IF NOT EXISTS commands_ad AFTER DELETE ON commands BEGIN
  INSERT INTO commands_fts(commands_fts,rowid,title,description,code,tags)
  VALUES ('delete',old.rowid,old.title,old.description,old.code,old.tags);
END;
CREATE TRIGGER IF NOT EXISTS commands_au AFTER UPDATE ON commands BEGIN
  INSERT INTO commands_fts(commands_fts,rowid,title,description,code,tags)
  VALUES ('delete',old.rowid,old.title,old.description,old.code,old.tags);
  INSERT INTO commands_fts(rowid,title,description,code,tags)
  VALUES (new.rowid,new.title,new.description,new.code,new.tags);
END;
```

FTS5 is supported on D1, so `commands_fts` gives you proper search over code and descriptions instead of `LIKE '%term%'` full scans.

## Why these columns

- **`parameters` as JSON Schema** — lets the Worker turn each row into an LLM tool definition on the fly, so the agent knows what arguments a command takes without hardcoding anything.
- **`risk` + `requires_approval`** — the gate for the editor phase. Anything `high` or flagged must be confirmed before the container executes it.
- **`command_runs`** — the audit trail. Once developers can trigger execution from an editor, you need to know who ran what, with which args, and what came back. Populate it *before* you enable execution, not after.
- **`command_versions`** — commands get edited; keep the old code so a run can be replayed against the version that actually executed.

## Worker side

```js
// search
const { results } = await env.DB.prepare(`
  SELECT c.slug, c.title, c.language, c.description
  FROM commands_fts f JOIN commands c ON c.rowid = f.rowid
  WHERE commands_fts MATCH ? AND c.status = 'active'
  ORDER BY rank LIMIT 20
`).bind(q).all();

// fetch one for the agent
const cmd = await env.DB.prepare(
  `SELECT * FROM commands WHERE slug = ? AND status = 'active'`
).bind(slug).first();

// log a run
await env.DB.prepare(
  `INSERT INTO command_runs (id,command_id,command_slug,version,language,args,requested_by,source,status)
   VALUES (?,?,?,?,?,?,?,?, 'pending')`
).bind(crypto.randomUUID(), cmd.id, cmd.slug, cmd.version, cmd.language,
       JSON.stringify(args), userEmail, 'agent').run();
```

Always use `.bind()` — never string-interpolate arguments into SQL or into the command line. Arguments should reach the container as `argv`/env vars, not concatenated into the script.

## One caution for the editor phase

Storing and serving commands is safe. *Executing* them is the part that needs design: the container has internet access, so a `high`-risk command is effectively remote code execution for anyone who can reach the Worker. Plan for authentication on the Worker (Cloudflare Access in front of the editor route is the simplest fit) and a server-side allowlist of `slug`s rather than accepting arbitrary code from the client.

Want me to retry the schema creation, or draft the Worker routes (`/api/commands`, `/api/commands/:slug`, `/api/runs`) next?