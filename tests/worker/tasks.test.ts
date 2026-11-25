import assert from "node:assert/strict";
import { test } from "node:test";
import { handleTasksRequest } from "../../src/worker/tasks.ts";
import { SqliteD1 } from "./sqlite-d1.ts";

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`https://app.test${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("task API seeds, creates, moves and deletes owner-scoped tasks", async () => {
  const db = new SqliteD1();
  const env = { DB: db as unknown as D1Database };
  const owner = "access:task-owner";

  const initial = await handleTasksRequest(
    request("GET", "/api/tasks"),
    env,
    owner,
    "owner@example.com",
  );
  assert.equal(initial.status, 200);
  const initialPayload = (await initial.json()) as {
    project: { name: string };
    tasks: Array<{ status: string }>;
  };
  assert.equal(initialPayload.project.name, "Online Marketing");
  assert.equal(initialPayload.tasks.length, 12);

  const created = await handleTasksRequest(
    request("POST", "/api/tasks", {
      title: "Ship the campaign",
      description: "Publish the final launch campaign.",
      status: "in_progress",
      priority: 1,
      dueDate: "2026-12-01",
    }),
    env,
    owner,
    "owner@example.com",
  );
  assert.equal(created.status, 201);
  const createdPayload = (await created.json()) as {
    task: { task_id: string; status: string; title: string };
  };
  assert.equal(createdPayload.task.title, "Ship the campaign");
  assert.equal(createdPayload.task.status, "in_progress");

  const moved = await handleTasksRequest(
    request("PUT", `/api/tasks/${createdPayload.task.task_id}`, {
      status: "done",
    }),
    env,
    owner,
    "owner@example.com",
  );
  assert.equal(moved.status, 200);
  const movedPayload = (await moved.json()) as {
    task: { status: string };
  };
  assert.equal(movedPayload.task.status, "done");

  const deleted = await handleTasksRequest(
    request("DELETE", `/api/tasks/${createdPayload.task.task_id}`),
    env,
    owner,
    "owner@example.com",
  );
  assert.equal(deleted.status, 204);
});

test("task API rejects invalid task writes", async () => {
  const db = new SqliteD1();
  const env = { DB: db as unknown as D1Database };
  const owner = "access:validation-owner";

  const missingTitle = await handleTasksRequest(
    request("POST", "/api/tasks", { title: "   " }),
    env,
    owner,
    "owner@example.com",
  );
  assert.equal(missingTitle.status, 400);

  const badStatus = await handleTasksRequest(
    request("POST", "/api/tasks", {
      title: "Invalid status",
      status: "cancelled",
    }),
    env,
    owner,
    "owner@example.com",
  );
  assert.equal(badStatus.status, 400);
});
