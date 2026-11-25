import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TasksPage } from "../../src/react-app/pages/TasksPage/TasksPage";

const uploaded = "2026-11-25T12:00:00Z";
function task(
  id: string,
  title: string,
  status: "todo" | "in_progress" | "done" | "blocked",
) {
  return {
    task_id: id,
    project_id: "project-1",
    title,
    description: `${title} description`,
    status,
    priority: 3,
    due_date: null,
    created_at: uploaded,
    updated_at: uploaded,
    assignees: [],
    tags: [],
  };
}

describe("task management page", () => {
  it("loads a board and creates a task through the modal", async () => {
    const first = task("task-1", "Prepare launch page", "todo");
    const created = task("task-2", "Publish campaign", "in_progress");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          project: {
            project_id: "project-1",
            name: "Online Marketing",
            description: null,
          },
          tasks: [first],
        }),
      )
      .mockResolvedValueOnce(Response.json({ task: created }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TasksPage />);

    expect(
      await screen.findByRole("heading", { name: "Prepare launch page" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New task" }));
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Publish campaign",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Publish campaign description",
    );
    await user.selectOptions(screen.getByLabelText("Status"), "in_progress");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Create task" })).toBeNull();
    });
    expect(
      screen.getByRole("heading", { name: "Publish campaign" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("switches to the task list and filters tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: {
            project_id: "project-1",
            name: "Online Marketing",
            description: null,
          },
          tasks: [
            task("task-1", "Prepare launch page", "todo"),
            task("task-2", "Review copy", "done"),
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<TasksPage />);
    await screen.findByRole("heading", { name: "Prepare launch page" });
    await user.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByText("Prepare launch page")).toBeTruthy();
    await user.type(
      screen.getByRole("textbox", { name: "Search tasks" }),
      "review",
    );
    expect(screen.queryByText("Prepare launch page")).toBeNull();
    expect(screen.getByText("Review copy")).toBeTruthy();
  });
});
