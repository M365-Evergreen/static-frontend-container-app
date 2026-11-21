<<<<<<< HEAD
// src/App.tsx

import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import cloudflareLogo from "./assets/Cloudflare_Logo.svg";
import honoLogo from "./assets/hono.svg";
import "./App.css";

function App() {
	const [count, setCount] = useState(0);
	const [name, setName] = useState("unknown");

	return (
		<>
			<div>
				<a href="https://vite.dev" target="_blank">
					<img src={viteLogo} className="logo" alt="Vite logo" />
				</a>
				<a href="https://react.dev" target="_blank">
					<img src={reactLogo} className="logo react" alt="React logo" />
				</a>
				<a href="https://hono.dev/" target="_blank">
					<img src={honoLogo} className="logo cloudflare" alt="Hono logo" />
				</a>
				<a href="https://workers.cloudflare.com/" target="_blank">
					<img
						src={cloudflareLogo}
						className="logo cloudflare"
						alt="Cloudflare logo"
					/>
				</a>
			</div>
			<h1><strong>CUNT</strong></h1>
			<div className="card">
				<button
					onClick={() => setCount((count) => count + 1)}
					aria-label="increment"
				>
					count is {count}
				</button>
				<p>
					Edit <code>src/App.tsx</code> and save to test HMR
				</p>
			</div>
			<div className="card">
				<button
					onClick={() => {
						fetch("/api/")
							.then((res) => res.json() as Promise<{ name: string }>)
							.then((data) => setName(data.name));
					}}
					aria-label="get name"
				>
					Name from API is: {name}
				</button>
				<p>
					Edit <code>worker/index.ts</code> to change the name
				</p>
			</div>
			<p className="read-the-docs">Click on the logos to learn more</p>
		</>
	);
}

export default App;
=======
import { FormEvent, useEffect, useRef, useState } from "react";
import "./App.css";
import { readSse, type RunningEvent } from "./sse.ts";

interface StoredMessage {
  sequence: number;
  role: "user" | "assistant";
  content: string;
  request_id: string;
}

interface HistoryResponse {
  session_id: string;
  messages: StoredMessage[];
}

interface Draft {
  requestId: string;
  prompt: string;
  status: "starting" | "running" | "cancelled" | "failed";
  progress: RunningEvent[];
  error?: string;
}

const SESSION_KEY = "static-frontend-container-app.session-id";

function newSessionId(): string {
  return crypto.randomUUID();
}

function storedSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = newSessionId();
  localStorage.setItem(SESSION_KEY, created);
  return created;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    return payload.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function App() {
  const [sessionId, setSessionId] = useState(storedSessionId);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const activeController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingHistory(true);
    setHistoryError("");
    void (async () => {
      try {
        const response = await fetch("/api/history", {
          headers: { "x-session-id": sessionId },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const history = (await response.json()) as HistoryResponse;
        setMessages(history.messages);
      } catch (error) {
        if (!controller.signal.aborted) {
          setHistoryError(error instanceof Error ? error.message : "Could not load history.");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingHistory(false);
      }
    })();
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    return () => activeController.current?.abort();
  }, []);

  const cancelRun = async () => {
    if (!draft || activeController.current === null) return;
    const controller = activeController.current;
    const requestId = draft.requestId;
    controller.abort();
    try {
      await fetch("/api/chat", {
        method: "DELETE",
        headers: { "x-session-id": sessionId, "x-request-id": requestId },
        cache: "no-store",
        keepalive: true,
      });
    } catch {
      // The local draft still represents cancellation when the network request fails.
    }
    setDraft((current) =>
      current?.requestId === requestId
        ? { ...current, status: "cancelled", error: "Run cancelled." }
        : current,
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || draft?.status === "starting" || draft?.status === "running") return;

    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    activeController.current = controller;
    setPrompt("");
    setDraft({ requestId, prompt: text, status: "starting", progress: [] });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
          "x-request-id": requestId,
        },
        cache: "no-store",
        body: JSON.stringify({ prompt: text, max_turns: 5 }),
        signal: controller.signal,
      });

      await readSse(response, controller.signal, (sse) => {
        if (sse.status === "running") {
          setDraft((current) =>
            current?.requestId === requestId
              ? { ...current, status: "running", progress: [...current.progress, sse] }
              : current,
          );
        } else if (sse.status === "done") {
          setMessages((current) => [
            ...current,
            { sequence: current.length + 1, role: "user", content: text, request_id: requestId },
            {
              sequence: current.length + 2,
              role: "assistant",
              content: sse.final_output,
              request_id: requestId,
            },
          ]);
          setDraft(null);
        } else {
          setDraft((current) =>
            current?.requestId === requestId
              ? { ...current, status: "failed", error: sse.message }
              : current,
          );
        }
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setDraft((current) =>
          current?.requestId === requestId
            ? {
                ...current,
                status: "failed",
                error: error instanceof Error ? error.message : "The request failed.",
              }
            : current,
        );
      }
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  };

  const newConversation = async () => {
    activeController.current?.abort();
    activeController.current = null;
    const controller = new AbortController();
    try {
      await fetch("/api/history", {
        method: "DELETE",
        headers: { "x-session-id": sessionId },
        signal: controller.signal,
      });
    } catch {
      // Generate a fresh local conversation even if clearing the old server state fails.
    }
    const next = newSessionId();
    localStorage.setItem(SESSION_KEY, next);
    setSessionId(next);
    setMessages([]);
    setDraft(null);
    setPrompt("");
  };

  const busy = draft?.status === "starting" || draft?.status === "running";

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Multi-agent workspace</p>
          <h1>Conversation</h1>
        </div>
        <button className="secondary-button" type="button" onClick={newConversation}>
          New conversation
        </button>
      </header>

      <section className="transcript" aria-live="polite" aria-busy={loadingHistory || busy}>
        {loadingHistory && <p className="status-card">Restoring conversation...</p>}
        {historyError && <p className="status-card error-status">{historyError}</p>}

        {!loadingHistory && messages.length === 0 && !draft && (
          <div className="empty-state">
            <p>Start a conversation</p>
            <span>The planner, analyst, and synthesizer will work sequentially.</span>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <article className="message user-message" key={`user-${message.sequence}`}>
              <span>You</span>
              <p>{message.content}</p>
            </article>
          ) : (
            <article className="message assistant-message" key={`assistant-${message.sequence}`}>
              <span>Agents</span>
              <p>{message.content}</p>
            </article>
          ),
        )}

        {draft && (
          <section className="draft">
            <article className="message user-message">
              <span>You</span>
              <p>{draft.prompt}</p>
            </article>
            {(draft.status === "starting" || draft.status === "running") && (
              <article className="progress-card">
                <div className="progress-heading">
                  <span>{draft.status === "starting" ? "Starting container..." : "Agents running"}</span>
                  {draft.status === "running" && <span>{draft.progress.length}/3</span>}
                </div>
                {draft.status === "starting" && <div className="progress-line" />}
                {draft.progress.map((event) => (
                  <div className="agent-progress" key={`${event.turn}-${event.agent}`}>
                    <span className="agent-name">{event.agent}</span>
                    <p>{event.output}</p>
                  </div>
                ))}
              </article>
            )}
            {draft.status === "cancelled" && (
              <p className="status-card cancelled-status">Cancelled. No messages were stored.</p>
            )}
            {draft.status === "failed" && (
              <p className="status-card error-status">{draft.error ?? "Run failed."}</p>
            )}
          </section>
        )}
      </section>

      <form className="composer" onSubmit={submit}>
        <label htmlFor="prompt">Prompt</label>
        <div className="composer-row">
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask the agents..."
            maxLength={8000}
            rows={3}
            disabled={busy}
          />
          {busy ? (
            <button className="cancel-button" type="button" onClick={cancelRun}>
              Cancel
            </button>
          ) : (
            <button className="send-button" type="submit" disabled={!prompt.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

export default App;
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)
