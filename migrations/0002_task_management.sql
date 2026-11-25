CREATE TABLE IF NOT EXISTS task_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS task_projects (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES task_users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_task_projects_owner
  ON task_projects(owner_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES task_projects(project_id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES task_users(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),
  priority INTEGER NOT NULL DEFAULT 3
    CHECK (priority BETWEEN 1 AND 5),
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status
  ON tasks(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_owner
  ON tasks(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES task_users(user_id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_comments (
  comment_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES task_users(user_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task
  ON task_comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS task_tags (
  tag_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS task_tag_links (
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES task_tags(tag_id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS task_attachments (
  attachment_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS task_activity_log (
  log_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES task_users(user_id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task
  ON task_activity_log(task_id, occurred_at);
