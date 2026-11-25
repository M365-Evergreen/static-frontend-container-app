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

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,                    -- crypto.randomUUID()
  bucket TEXT NOT NULL DEFAULT 'paulibaby-agent',
  key TEXT NOT NULL,                      -- R2 object key
  etag TEXT NOT NULL,                     -- changes on every re-upload
  size INTEGER NOT NULL,
  content_type TEXT,
  uploaded_at TEXT,                       -- R2 object's own uploaded timestamp
  source TEXT NOT NULL DEFAULT 'worker'
    CHECK (source IN ('worker','dashboard','wrangler','presigned','backfill')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','indexed','skipped','failed')),
  error TEXT,
  text_chars INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (bucket, key)
);
CREATE INDEX IF NOT EXISTS idx_files_status ON files (status, created_at);
CREATE INDEX IF NOT EXISTS idx_files_etag ON files (key, etag);

CREATE TABLE IF NOT EXISTS file_chunks (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (file_id, chunk_index)
);

CREATE VIRTUAL TABLE IF NOT EXISTS file_chunks_fts USING fts5(
  content, content='file_chunks', content_rowid='rowid', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS file_chunks_ai AFTER INSERT ON file_chunks BEGIN
  INSERT INTO file_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS file_chunks_ad AFTER DELETE ON file_chunks BEGIN
  INSERT INTO file_chunks_fts(file_chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS file_chunks_au AFTER UPDATE ON file_chunks BEGIN
  INSERT INTO file_chunks_fts(file_chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO file_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TABLE IF NOT EXISTS chat_conversations (
  session_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL CHECK (message_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_owner
  ON chat_conversations (owner_id, updated_at DESC, session_id DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  session_id TEXT NOT NULL REFERENCES chat_conversations(session_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (session_id, sequence),
  UNIQUE (session_id, request_id, role)
);
