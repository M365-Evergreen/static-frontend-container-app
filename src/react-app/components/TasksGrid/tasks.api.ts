import { readApiError } from "../../chat/chat.api.ts";

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

export interface TaskProject {
  project_id: string;
  name: string;
  description: string | null;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: number;
  dueDate?: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function taskRecord(value: unknown): value is TaskRecord {
  return (
    record(value) &&
    typeof value.task_id === "string" &&
    typeof value.project_id === "string" &&
    typeof value.title === "string" &&
    (value.description === null || typeof value.description === "string") &&
    (value.status === "todo" ||
      value.status === "in_progress" ||
      value.status === "done" ||
      value.status === "blocked") &&
    typeof value.priority === "number" &&
    Number.isInteger(value.priority) &&
    value.priority >= 1 &&
    value.priority <= 5 &&
    (value.due_date === null || typeof value.due_date === "string") &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    Array.isArray(value.assignees) &&
    value.assignees.every((assignee) => typeof assignee === "string") &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string")
  );
}

export async function loadTasks(
  signal: AbortSignal,
): Promise<{ project: TaskProject; tasks: TaskRecord[] }> {
  const response = await fetch("/api/tasks", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const payload: unknown = await response.json();
  if (
    !record(payload) ||
    !record(payload.project) ||
    typeof payload.project.project_id !== "string" ||
    typeof payload.project.name !== "string" ||
    (payload.project.description !== null &&
      typeof payload.project.description !== "string") ||
    !Array.isArray(payload.tasks) ||
    !payload.tasks.every(taskRecord)
  ) {
    throw new Error("The server returned an invalid task list.");
  }
  return {
    project: {
      project_id: payload.project.project_id,
      name: payload.project.name,
      description:
        typeof payload.project.description === "string"
          ? payload.project.description
          : null,
    },
    tasks: payload.tasks,
  };
}

export async function createTask(
  input: TaskInput,
  signal: AbortSignal,
): Promise<TaskRecord> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const payload: unknown = await response.json();
  if (!record(payload) || !taskRecord(payload.task)) {
    throw new Error("The server returned an invalid created task.");
  }
  return payload.task;
}

export async function updateTask(
  taskId: string,
  input: Partial<TaskInput>,
  signal: AbortSignal,
): Promise<TaskRecord> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const payload: unknown = await response.json();
  if (!record(payload) || !taskRecord(payload.task)) {
    throw new Error("The server returned an invalid updated task.");
  }
  return payload.task;
}

export async function deleteTask(
  taskId: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    cache: "no-store",
    signal,
  });
  if (response.status !== 204) {
    throw new Error(await readApiError(response));
  }
}
