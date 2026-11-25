### **Core Entities**

#### **Users**

Stores account information for people who create or manage tasks.

```sql
CREATE TABLE users (
    user_id        BIGSERIAL PRIMARY KEY,
    email          VARCHAR(255) UNIQUE NOT NULL,
    full_name      VARCHAR(255) NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

```

#### **Projects**

Groups tasks under a shared context.

```sql
CREATE TABLE projects (
    project_id     BIGSERIAL PRIMARY KEY,
    name           VARCHAR(255) NOT NULL,
    description    TEXT,
    owner_id       BIGINT REFERENCES users(user_id),
    created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

```

#### **Tasks**

The central object: each task belongs to a project and may have deadlines, priorities, and statuses.

```sql
CREATE TABLE tasks (
    task_id        BIGSERIAL PRIMARY KEY,
    project_id     BIGINT REFERENCES projects(project_id) ON DELETE CASCADE,
    title          VARCHAR(255) NOT NULL,
    description    TEXT,
    status         VARCHAR(50) NOT NULL DEFAULT 'todo',   -- todo, in_progress, done, blocked
    priority       SMALLINT NOT NULL DEFAULT 3,           -- 1=high, 5=low
    due_date       DATE,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

```

### **Assignment &amp; Collaboration**

#### **Task Assignees**

Allows multiple users per task.

```sql
CREATE TABLE task_assignees (
    task_id    BIGINT REFERENCES tasks(task_id) ON DELETE CASCADE,
    user_id    BIGINT REFERENCES users(user_id),
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
);

```

#### **Comments**

Supports discussion on tasks.

```sql
CREATE TABLE task_comments (
    comment_id   BIGSERIAL PRIMARY KEY,
    task_id      BIGINT REFERENCES tasks(task_id) ON DELETE CASCADE,
    user_id      BIGINT REFERENCES users(user_id),
    body         TEXT NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

```

### **Optional Extensions**

#### **Tags**

Flexible categorisation.

```sql
CREATE TABLE task_tags (
    tag_id     BIGSERIAL PRIMARY KEY,
    name       VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE task_tags (
    task_id    BIGINT REFERENCES tasks(task_id) ON DELETE CASCADE,
    tag_id     BIGINT REFERENCES tags(tag_id),
    PRIMARY KEY (task_id, tag_id)
);

```

#### **Attachments**

Links files to tasks.

```sql
CREATE TABLE task_attachments (
    attachment_id BIGSERIAL PRIMARY KEY,
    task_id       BIGINT REFERENCES tasks(task_id) ON DELETE CASCADE,
    file_url      TEXT NOT NULL,
    uploaded_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

```

#### **Activity Log**

Tracks changes for auditing.

```sql
CREATE TABLE task_activity_log (
    log_id      BIGSERIAL PRIMARY KEY,
    task_id     BIGINT REFERENCES tasks(task_id) ON DELETE CASCADE,
    user_id     BIGINT REFERENCES users(user_id),
    action      VARCHAR(255) NOT NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);

```

### **Relationship Summary**

- **users** ↔ **projects**: one‑to‑many
- **projects** ↔ **tasks**: one‑to‑many
- **tasks** ↔ **task\_assignees**: many‑to‑many
- **tasks** ↔ **tags**: many‑to‑many
- **tasks** ↔ **comments**: one‑to‑many
- **tasks** ↔ **attachments**: one‑to‑many
