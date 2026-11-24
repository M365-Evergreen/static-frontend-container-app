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
