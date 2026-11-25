import { errorResponse } from "./session.ts";
import { SessionError } from "./session-store.ts";

export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

export interface TaskRecord {
  task_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  assignees: string[];
  tags: string[];
}

interface TaskInput {
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  assignees?: unknown;
  tags?: unknown;
}

const statuses = new Set<TaskStatus>([
  "todo",
  "in_progress",
  "done",
  "blocked",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function now(): string {
  return new Date().toISOString();
}

async function ensureOwner(
  db: D1Database,
  ownerId: string,
  email: string | undefined,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO task_users (user_id, email, full_name)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email = excluded.email,
         full_name = CASE
           WHEN task_users.full_name = '' THEN excluded.full_name
           ELSE task_users.full_name
         END`,
    )
    .bind(ownerId, email || `${ownerId}@access.local`, ownerId)
    .run();
}

async function ensureStarterTasks(
  db: D1Database,
  ownerId: string,
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT project_id FROM task_projects
       WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1`,
    )
    .bind(ownerId)
    .first<{ project_id: string }>();
  if (existing) return existing.project_id;

  const projectId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO task_projects (project_id, owner_id, name, description)
       VALUES (?, ?, 'Online Marketing', 'Campaign planning and launch work')`,
    )
    .bind(projectId, ownerId)
    .run();

  const starters: Array<[string, string, TaskStatus, number]> = [
    ["Media outlets", "", "todo", 2],
    [
      "Elevator pitch",
      "A sharp, concise summary for partners and customers.",
      "todo",
      2,
    ],
    ["Video strategies", "", "todo", 3],
    [
      "Launch on the Web",
      "Prepare the website and launch checklist.",
      "todo",
      3,
    ],
    ["Messaging and branding", "", "in_progress", 1],
    [
      "Marketing campaign for launch events",
      "Coordinate launch event messaging.",
      "in_progress",
      2,
    ],
    [
      "Channel analysis for print vs digital",
      "Compare the return across each channel.",
      "in_progress",
      3,
    ],
    ["Social media strategy", "", "in_progress", 2],
    ["Interview talking points", "", "blocked", 2],
    ["Product launch timeline", "", "blocked", 2],
    ["European product launch", "", "blocked", 1],
    ["VIP event - US", "", "done", 2],
  ];
  const statements = starters.map(([title, description, status, priority]) => {
    const taskId = crypto.randomUUID();
    return db
      .prepare(
        `INSERT INTO tasks
         (task_id, project_id, owner_id, title, description, status, priority, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        taskId,
        projectId,
        ownerId,
        title,
        description || null,
        status,
        priority,
      );
  });
  await db.batch(statements);
  return projectId;
}

async function readTasks(
  db: D1Database,
  ownerId: string,
  projectId: string,
): Promise<TaskRecord[]> {
  const result = await db
    .prepare(
      `SELECT task_id, project_id, title, description, status, priority,
              due_date, created_at, updated_at
       FROM tasks
       WHERE owner_id = ? AND project_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(ownerId, projectId)
    .all<{
      task_id: string;
      project_id: string;
      title: string;
      description: string | null;
      status: TaskStatus;
      priority: number;
      due_date: string | null;
      created_at: string;
      updated_at: string;
    }>();
  return (result.results || []).map((task) => ({
    ...task,
    assignees: [],
    tags: [],
  }));
}

function invalid(message: string): Response {
  return errorResponse(new SessionError("invalid_task", message, 400));
}

function parseInput(body: unknown): TaskInput | null {
  if (!record(body)) return null;
  return body;
}

export async function handleTasksRequest(
  request: Request,
  env: { DB: D1Database },
  ownerId: string,
  email: string | undefined,
): Promise<Response> {
  await ensureOwner(env.DB, ownerId, email);
  const url = new URL(request.url);
  const taskMatch = url.pathname.match(/^\/api\/tasks\/([A-Za-z0-9-]+)$/);

  if (request.method === "GET" && url.pathname === "/api/tasks") {
    try {
      const projectId = await ensureStarterTasks(env.DB, ownerId);
      const project = await env.DB.prepare(
        `SELECT project_id, name, description
           FROM task_projects WHERE project_id = ? AND owner_id = ?`,
      )
        .bind(projectId, ownerId)
        .first<{
          project_id: string;
          name: string;
          description: string | null;
        }>();
      if (!project) throw new Error("Missing task project.");
      return Response.json({
        project,
        tasks: await readTasks(env.DB, ownerId, projectId),
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "task_list_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return errorResponse(
        new SessionError(
          "task_storage_unavailable",
          "Tasks could not be loaded. Try again.",
          503,
        ),
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/tasks") {
    const input = parseInput(await request.json().catch(() => null));
    if (
      !input ||
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.trim().length > 255
    )
      return invalid("Enter a task title of up to 255 characters.");
    if (
      input.description !== undefined &&
      input.description !== null &&
      typeof input.description !== "string"
    )
      return invalid("Task description must be text.");
    if (input.status !== undefined && !statuses.has(input.status as TaskStatus))
      return invalid("Choose a valid task status.");
    if (
      input.priority !== undefined &&
      (!Number.isInteger(input.priority) ||
        (input.priority as number) < 1 ||
        (input.priority as number) > 5)
    )
      return invalid("Priority must be a whole number from 1 to 5.");
    if (
      input.dueDate !== undefined &&
      input.dueDate !== null &&
      (typeof input.dueDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))
    )
      return invalid("Enter a valid due date.");

    try {
      const projectId = await ensureStarterTasks(env.DB, ownerId);
      const taskId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO tasks
           (task_id, project_id, owner_id, title, description, status, priority, due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          taskId,
          projectId,
          ownerId,
          input.title.trim(),
          typeof input.description === "string" ? input.description : null,
          typeof input.status === "string" ? input.status : "todo",
          typeof input.priority === "number" ? input.priority : 3,
          typeof input.dueDate === "string" ? input.dueDate : null,
        )
        .run();
      const task = await env.DB.prepare(
        `SELECT task_id, project_id, title, description, status, priority,
                  due_date, created_at, updated_at
           FROM tasks WHERE task_id = ? AND owner_id = ?`,
      )
        .bind(taskId, ownerId)
        .first<TaskRecord>();
      if (!task) throw new Error("Created task could not be loaded.");
      return Response.json(
        { task: { ...task, assignees: [], tags: [] } },
        {
          status: 201,
        },
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "task_create_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return errorResponse(
        new SessionError(
          "task_storage_unavailable",
          "The task could not be created. Try again.",
          503,
        ),
      );
    }
  }

  if (taskMatch && ["PUT", "PATCH"].includes(request.method)) {
    const taskId = taskMatch[1] ?? "";
    const input = parseInput(await request.json().catch(() => null));
    if (!input) return invalid("Send a valid task update.");
    if (
      input.title !== undefined &&
      (typeof input.title !== "string" ||
        !input.title.trim() ||
        input.title.trim().length > 255)
    )
      return invalid("Enter a task title of up to 255 characters.");
    if (input.status !== undefined && !statuses.has(input.status as TaskStatus))
      return invalid("Choose a valid task status.");
    if (
      input.priority !== undefined &&
      (!Number.isInteger(input.priority) ||
        (input.priority as number) < 1 ||
        (input.priority as number) > 5)
    )
      return invalid("Priority must be a whole number from 1 to 5.");
    if (
      input.dueDate !== undefined &&
      input.dueDate !== null &&
      (typeof input.dueDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))
    )
      return invalid("Enter a valid due date.");

    const fields: string[] = [];
    const values: unknown[] = [];
    if (typeof input.title === "string") {
      fields.push("title = ?");
      values.push(input.title.trim());
    }
    if (input.description !== undefined) {
      fields.push("description = ?");
      values.push(
        typeof input.description === "string" ? input.description : null,
      );
    }
    if (typeof input.status === "string") {
      fields.push("status = ?");
      values.push(input.status);
    }
    if (typeof input.priority === "number") {
      fields.push("priority = ?");
      values.push(input.priority);
    }
    if (input.dueDate !== undefined) {
      fields.push("due_date = ?");
      values.push(typeof input.dueDate === "string" ? input.dueDate : null);
    }
    if (!fields.length) return invalid("No task changes were provided.");

    fields.push("updated_at = ?");
    values.push(now(), taskId, ownerId);
    try {
      const result = await env.DB.prepare(
        `UPDATE tasks SET ${fields.join(", ")}
           WHERE task_id = ? AND owner_id = ?`,
      )
        .bind(...values)
        .run();
      if (result.meta.changes === 0) {
        return errorResponse(
          new SessionError(
            "task_not_found",
            "This task is no longer available.",
            404,
          ),
        );
      }
      const task = await env.DB.prepare(
        `SELECT task_id, project_id, title, description, status, priority,
                  due_date, created_at, updated_at
           FROM tasks WHERE task_id = ? AND owner_id = ?`,
      )
        .bind(taskId, ownerId)
        .first<TaskRecord>();
      if (!task) throw new Error("Updated task could not be loaded.");
      return Response.json({ task: { ...task, assignees: [], tags: [] } });
    } catch (error) {
      if (error instanceof SessionError) throw error;
      console.error(
        JSON.stringify({
          event: "task_update_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return errorResponse(
        new SessionError(
          "task_storage_unavailable",
          "The task could not be updated. Try again.",
          503,
        ),
      );
    }
  }

  if (request.method === "DELETE" && taskMatch) {
    const taskId = taskMatch[1] ?? "";
    const result = await env.DB.prepare(
      `DELETE FROM tasks WHERE task_id = ? AND owner_id = ?`,
    )
      .bind(taskId, ownerId)
      .run();
    if (result.meta.changes === 0) {
      return errorResponse(
        new SessionError(
          "task_not_found",
          "This task is no longer available.",
          404,
        ),
      );
    }
    return new Response(null, { status: 204 });
  }

  return errorResponse(
    new SessionError(
      "method_not_allowed",
      "Use the task API with a supported method.",
      405,
    ),
  );
}
