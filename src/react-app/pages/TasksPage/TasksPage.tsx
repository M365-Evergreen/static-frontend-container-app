import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Form,
  Heading,
  Input,
  Label,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  TextArea,
  TextField,
} from "react-aria-components";
import {
  CalendarDays,
  Check,
  DeleteIcon,
  EditIcon,
  View,
  LayoutGrid,
  List,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  createTask,
  deleteTask,
  loadTasks,
  updateTask,
  type TaskRecord,
  type TaskStatus,
} from "../../components/TasksGrid/tasks.api";
import styles from "./TasksPage.module.css";

const columns: Array<{ id: TaskStatus; label: string }> = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

const priorityLabels = ["", "High", "Medium", "Normal", "Low", "Lowest"];

function dueLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

interface EditorState {
  task: TaskRecord | null;
  status: TaskStatus;
  title: string;
  description: string;
  priority: number;
  dueDate: string;
}

const emptyEditor = (status: TaskStatus = "todo"): EditorState => ({
  task: null,
  status,
  title: "",
  description: "",
  priority: 3,
  dueDate: "",
});

export function TasksPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
 // const [projectName, setProjectName] = useState("Online Marketing");
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const dragId = useRef<string | null>(null);

  async function refresh(signal?: AbortSignal) {
    const active = signal ?? new AbortController().signal;
    setLoading(true);
    setError("");
    try {
      const data = await loadTasks(active);
      // setProjectName(data.project.name);
      setTasks(data.tasks);
    } catch (reason) {
      if (!active.aborted) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Tasks could not be loaded.",
        );
      }
    } finally {
      if (!active.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void refresh(active.signal);
    return () => {
      active.abort();
      controller.current = null;
    };
  }, []);

  function openCreate(status: TaskStatus = "todo") {
    setEditor(emptyEditor(status));
  }

  function openEdit(task: TaskRecord) {
    setEditor({
      task,
      status: task.status,
      title: task.title,
      description: task.description ?? "",
      priority: task.priority,
      dueDate: task.due_date ?? "",
    });
  }

  async function saveEditor() {
    if (!editor || !editor.title.trim()) {
      setError("Enter a task title.");
      return;
    }
    const active = new AbortController();
    setSaving(true);
    setError("");
    try {
      const input = {
        title: editor.title.trim(),
        description: editor.description.trim() || null,
        status: editor.status,
        priority: editor.priority,
        dueDate: editor.dueDate || null,
      };
      const task = editor.task
        ? await updateTask(editor.task.task_id, input, active.signal)
        : await createTask(input, active.signal);
      setTasks((current) =>
        editor.task
          ? current.map((item) => (item.task_id === task.task_id ? task : item))
          : [...current, task],
      );
      setEditor(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The task could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function moveTask(taskId: string, status: TaskStatus) {
    const current = tasks.find((task) => task.task_id === taskId);
    if (!current || current.status === status) return;
    const active = new AbortController();
    setTasks((items) =>
      items.map((task) =>
        task.task_id === taskId ? { ...task, status } : task,
      ),
    );
    try {
      const updated = await updateTask(taskId, { status }, active.signal);
      setTasks((items) =>
        items.map((task) => (task.task_id === taskId ? updated : task)),
      );
    } catch (reason) {
      setTasks((items) =>
        items.map((task) => (task.task_id === taskId ? current : task)),
      );
      setError(
        reason instanceof Error
          ? reason.message
          : "The task could not be moved.",
      );
    }
  }

  async function removeTask(taskId: string) {
    const active = new AbortController();
    try {
      await deleteTask(taskId, active.signal);
      setTasks((items) => items.filter((task) => task.task_id !== taskId));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The task could not be deleted.",
      );
    }
  }

  const filtered = tasks.filter((task) => {
    const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.breadcrumb}>Planner</div>
       {/* <h1>{projectName}</h1> */}
        </div>
        <div className={styles.headerActions}>
          <TextField aria-label="Search tasks" className={styles.searchField}>
            <Search size={17} aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search tasks"
            />
          </TextField>
          <div className={styles.viewToggle} aria-label="Task view">
            <Button
              aria-label="Board view"
              aria-pressed={view === "board"}
              onPress={() => setView("board")}
            >
              <LayoutGrid size={17} aria-hidden="true" />
            </Button>
            <Button
              aria-label="List view"
              aria-pressed={view === "list"}
              onPress={() => setView("list")}
            >
              <List size={17} aria-hidden="true" />
            </Button>
          </div>
          <Button className={styles.newButton} onPress={() => openCreate()}>
            <Plus size={17} aria-hidden="true" />
            New task
          </Button>
        </div>
      </header>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className={styles.loading} role="status">
          Loading tasks…
        </div>
      ) : view === "board" ? (
        <div className={styles.board}>
          {columns.map((column) => {
            const columnTasks = filtered.filter(
              (task) => task.status === column.id,
            );
            return (
              <section
                className={styles.column}
                key={column.id}
                aria-labelledby={`column-${column.id}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragId.current) void moveTask(dragId.current, column.id);
                  dragId.current = null;
                }}
              >
                <div className={styles.columnHeading}>
                  <h2 id={`column-${column.id}`}>
                    {column.label}
                    <span>{columnTasks.length}</span>
                  </h2>
                  <Button
                    aria-label={`Add task to ${column.label}`}
                    onPress={() => openCreate(column.id)}
                  >
                    <Plus size={16} aria-hidden="true" />
                  </Button>
                </div>
                <div className={styles.cardList}>
                  {columnTasks.map((task) => (
                    <article
                      className={styles.taskCard}
                      key={task.task_id}
                      draggable
                      onDragStart={() => {
                        dragId.current = task.task_id;
                      }}
                      onDragEnd={() => {
                        dragId.current = null;
                      }}
                    >
                      <div className={styles.cardTop}>
                        <button
                          type="button"
                          className={`${styles.checkButton} ${task.status === "done" ? styles.checked : ""}`}
                          aria-label={
                            task.status === "done"
                              ? "Mark incomplete"
                              : "Mark complete"
                          }
                          onClick={() =>
                            void moveTask(
                              task.task_id,
                              task.status === "done" ? "todo" : "done",
                            )
                          }
                        >
                          {task.status === "done" && (
                            <Check size={13} aria-hidden="true" />
                          )}
                        </button>
                        <MenuTrigger>
                          <Button
                            aria-label={`Actions for ${task.title}`}
                            className={styles.cardMenu}
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </Button>
                          <Menu
                            onAction={(action) => {
                              if (action === "edit") openEdit(task);
                              if (action === "delete")
                                void removeTask(task.task_id);
                            }}
                          >
                            <MenuItem id="edit">Edit task</MenuItem>
                            <MenuItem id="delete">Delete task</MenuItem>
                          </Menu>
                        </MenuTrigger>
                      </div>
                      <button
                        type="button"
                        className={styles.cardBody}
                        onClick={() => openEdit(task)}
                      >
                        <h3>{task.title}</h3>
                        {task.description && <p>{task.description}</p>}
                      </button>
                      <div className={styles.cardMeta}>
                        {task.due_date && (
                          <span>
                            <CalendarDays size={13} aria-hidden="true" />
                            {dueLabel(task.due_date)}
                          </span>
                        )}
                        {task.tags.length > 0 && (
                          <span className={styles.tag}>{task.tags[0]}</span>
                        )}
                        {task.priority <= 2 && (
                          <span className={styles.priority}>
                            {priorityLabels[task.priority]}
                          </span>
                        )}
                      </div>
                      <div className={styles.cardFooter}>
                        <div className={styles.avatars} aria-label="Assignees">
                          {task.assignees.slice(0, 3).map((assignee, index) => (
                            <span key={`${assignee}-${index}`} title={assignee}>
                              {assignee.slice(0, 2).toUpperCase()}
                            </span>
                          ))}
                        </div>
                        <div className={styles.cardCounts}>
                          <span>
                            <MessageSquare size={13} aria-hidden="true" />0
                          </span>
                          <span>
                            <Check size={13} aria-hidden="true" />0
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                  {columnTasks.length === 0 && (
                    <button
                      type="button"
                      className={styles.emptyColumn}
                      onClick={() => openCreate(column.id)}
                    >
                      <Plus size={16} aria-hidden="true" />
                      Add task
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className={styles.list}>
          <div className={styles.listHeader}>
            <span>Task</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Due</span>
            <span />
          </div>
          {filtered.map((task) => (
            <div className={styles.listRow} key={task.task_id}>
              <button
                type="button"
                className={styles.listTitle}
                onClick={() => openEdit(task)}
              >
                <span
                  className={`${styles.listCheck} ${task.status === "done" ? styles.checked : ""}`}
                >
                  {task.status === "done" && (
                    <Check size={12} aria-hidden="true" />
                  )}
                </span>
                <span>{task.title}</span>
              </button>
              <span className={styles.statusName}>
                {columns.find((column) => column.id === task.status)?.label}
              </span>
              <span>{priorityLabels[task.priority]}</span>
              <span>{dueLabel(task.due_date) ?? "No date"}</span>
              <MenuTrigger>
                <Button aria-label={`Actions for ${task.title}`}>
                  <MoreHorizontal size={16} aria-hidden="true" />
                </Button>
                <Menu
                  onAction={(action) => {
                    if (action === "edit") openEdit(task);
                    if (action === "delete") void removeTask(task.task_id);
                  }}
                >
                  <Button id="edit"><EditIcon size={16} aria-hidden="true" /></Button>
                  <Button id="delete"><DeleteIcon size={16} aria-hidden="true" /></Button>
                <Button id="view"><View size={16} aria-hidden="true" /></Button>
                </Menu>
              </MenuTrigger>
            </div>
          ))}
        </div>
      )}

      <ModalOverlay
        isOpen={editor !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setEditor(null);
        }}
        isDismissable={!saving}
        className={styles.modalOverlay}
      >
        <Modal className={styles.modal}>
          <Dialog className={styles.dialog}>
            <div className={styles.modalHeader}>
              <Heading slot="title">
                {editor?.task ? "Edit task" : "Create task"}
              </Heading>
              <Button
                aria-label="Close"
                isDisabled={saving}
                onPress={() => setEditor(null)}
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
            {editor && (
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveEditor();
                }}
              >
                <TextField
                  isRequired
                  value={editor.title}
                  onChange={(title) => setEditor({ ...editor, title })}
                >
                  <Label>Title</Label>
                  <Input placeholder="What needs to be done?" />
                </TextField>
                <TextField
                  value={editor.description}
                  onChange={(description) =>
                    setEditor({ ...editor, description })
                  }
                >
                  <Label>Description</Label>
                  <TextArea placeholder="Add context or acceptance criteria" />
                </TextField>
                <div className={styles.formGrid}>
                  <label>
                    <span>Status</span>
                    <select
                      value={editor.status}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          status: event.currentTarget.value as TaskStatus,
                        })
                      }
                    >
                      {columns.map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Priority</span>
                    <select
                      value={editor.priority}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          priority: Number(event.currentTarget.value),
                        })
                      }
                    >
                      {[1, 2, 3, 4, 5].map((priority) => (
                        <option key={priority} value={priority}>
                          {priorityLabels[priority]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Due date</span>
                    <input
                      type="date"
                      value={editor.dueDate}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          dueDate: event.currentTarget.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className={styles.modalActions}>
                  {editor.task && (
                    <Button
                      className={styles.deleteButton}
                      isDisabled={saving}
                      onPress={() => {
                        void removeTask(editor.task!.task_id);
                        setEditor(null);
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      Delete
                    </Button>
                  )}
                  <div>
                    <Button isDisabled={saving} onPress={() => setEditor(null)}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className={styles.saveButton}
                      isDisabled={saving}
                    >
                      {saving
                        ? "Saving…"
                        : editor.task
                          ? "Save changes"
                          : "Create task"}
                    </Button>
                  </div>
                </div>
              </Form>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
