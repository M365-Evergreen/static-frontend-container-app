# MVP Implementation Plan

## Scope and decisions

Build a single-conversation chat application using OpenAI, three sequential agents,
streamed progress, and durable conversation history.

Confirmed decisions:

- OpenAI only.
- Conversation history survives container sleep and restarts.
- Model-only research and analysis; no live web search or source verification.

Preserve the existing architecture: React + Vite, Cloudflare Workers Static Assets,
a Worker gateway, and a Python 3.12 FastAPI backend in Cloudflare Containers.
Use the existing SQLite-backed Durable Object as the authoritative conversation
store. D1, R2, and the Agents SDK are not needed for this scope.

## Current scaffold gaps

These findings describe the repository inspected during planning:

- The frontend is the Vite demo under `src\react-app`, rather than the README's
  `src\client`.
- The backend emits simulated agent outputs and does not call OpenAI.
- Python history is in memory and disappears when the container stops.
  Session-pinned routing does not make that memory durable.
- Worker routing falls back to a shared `default-session`. Session IDs accepted
  through query parameters are not normalized into the header consumed by Python.
- The Dockerfile has an unreliable dependency-install fallback, an inconsistent
  executable environment, and an incorrect healthcheck.
- Package manifests, npm and pnpm lockfiles, installed dependencies, and generated
  Worker types disagree.
- The README and repository instructions contain escaped Markdown and describe
  paths or behavior that do not match the scaffold.

Existing worktree changes must be preserved during implementation.

## Target architecture

```text
React SPA
  |
  | /api/* with x-session-id
  v
Worker gateway
  |
  | validated, session-pinned routing
  v
AgentContainer Durable Object
  |-- durable conversation history and request coordination
  |
  | authoritative history supplied for each run
  v
FastAPI container
  |
  | planner -> analyst/researcher -> synthesizer
  v
OpenAI
```

The Durable Object owns completed conversation history. Python memory may cache
context, but must never be the source of truth. Container shutdown must not require
a last-minute memory flush for completed turns to survive.

Retain the existing Wrangler project and Container subclass approach. Reconcile
the installed versions before choosing exact APIs; do not introduce an unrelated
CLI, hosting, or Container API migration.

## Implementation phases

### 1. Repair the foundation

- Select one package manager and reconcile the manifest and its authoritative
  lockfile without silently upgrading dependencies.
- Make typechecking cover the frontend, Vite configuration, and Worker projects.
- Restore appropriate lint scripts and their declared dependencies.
- Regenerate Cloudflare binding types from the actual configuration.
- Fix the container dependency installation and runtime executable environment.
  Use a reproducible Python dependency lock, remove the success-shaped install
  fallback, and retain a lean, non-root Python 3.12 image.
- Make the healthcheck target `http://127.0.0.1:8080/health` and keep Uvicorn bound
  to `0.0.0.0:8080`.
- Correct documentation formatting, paths, and build/deployment instructions.
  Prefer preserving `src\react-app` over an unnecessary directory migration.

Completion criterion: the frontend and Worker build successfully, and the
container starts with a responsive health endpoint.

### 2. Establish durable sessions

- Require a validated session UUID; remove shared default-session behavior.
- Normalize any supported query-based ID into the canonical `x-session-id` header,
  or remove that alternative from the public contract.
- Route every conversation to its corresponding Durable Object.
- Store ordered completed messages and request IDs in Durable Object storage.
- Add session-scoped history retrieval and deletion endpoints.
- Hydrate every Python run from authoritative stored history. Do not accept
  client-supplied history as authoritative.
- Coordinate one active run per session and reject overlapping submissions.
  Ensure interruption or timeout cannot leave a session permanently busy.
- Use request IDs for retry deduplication.

Completion criterion: browser reload and container restart preserve completed
turns, and separate sessions cannot read or influence one another.

### 3. Implement real agents

- Extract the orchestrator and specialized agent definitions from
  `agents\main.py`.
- Use an asynchronous OpenAI client with a configurable model.
- Run planner, analyst/researcher, and synthesizer sequentially, supplying prior
  conversation context and preceding agent results.
- Clearly label research as model-only analysis without current-source
  verification or invented citations.
- Define inputs, outputs, and internal run payloads with Pydantic v2 models.
- Add explicit input-size, output-token, execution-time, and agent-call limits.
- Treat `max_turns` as a hard agent-call ceiling. Reject values too small to
  complete the three-agent pipeline rather than returning partial work as success.
- Surface missing configuration and provider failures explicitly.
- Pass only the required OpenAI secret from the Worker environment into the
  container; never put secret values in source, images, or logs.

Completion criterion: prompts produce genuine intermediate outputs and a
synthesized answer; follow-up prompts use earlier completed turns.

### 4. Deliver the streaming UI

- Replace the starter demo with a transcript, prompt composer, agent progress,
  container-startup indicator, cancel action, and new-conversation action.
- Persist the conversation UUID locally and restore server-side history on reload.
- Use relative API paths and POST `fetch` streaming, rather than native
  `EventSource`, for chat requests.
- Define a typed SSE contract shared by the public API and frontend, with Python
  models representing the same event shapes.
- Parse SSE across arbitrary network chunk boundaries and handle malformed frames
  and unexpected stream termination explicitly.
- Release stream readers and abort requests on cancellation, conversation change,
  and component unmount.
- Keep cancelled or failed drafts distinguishable from completed stored messages.

Completion criterion: users can submit, watch progress, cancel, reload, and
continue a conversation without duplicate messages.

### 5. Harden and release

- Add focused backend, Worker, and frontend tests for introduced behavior.
- Add structured operational logs without prompts or secret values.
- Handle shutdown and cancellation cleanly, including provider-client cleanup.
- Configure Worker-first routing for API paths so SPA fallback cannot mask API
  responses.
- Document local setup, secrets, validation, build, and deployment.
- Configure private access before exposing the paid-model endpoint. Session UUIDs
  identify conversations; they are not a substitute for authentication.
- Verify the intended Cloudflare account, resource configuration, and container
  capacity before deployment.

Completion criterion: a protected deployment passes the acceptance scenarios.

## Persistence and streaming contract

The Durable Object coordinates each run and supplies its authoritative history to
the backend. It consumes structured progress and completion events while
forwarding the stream to the browser.

Commit the completed user/assistant exchange and its request ID durably before
forwarding terminal success. Failed or cancelled runs must not become successful
history. Define retry behavior using the stored request ID so an interrupted
response does not duplicate a committed turn.

Return HTTP errors for validation, configuration, or startup failures detected
before streaming begins. After streaming begins, emit an explicit terminal error
event. An unexpected stream close is not success.

Propagate cancellation where supported, enforce a server-side run deadline, and
release session coordination on completion, failure, or interruption. Avoid
holding a Durable Object initialization/concurrency block across a long LLM run.

## Acceptance scenarios

1. A prompt runs all three agents and yields progress followed by a final answer.
2. A follow-up uses prior completed conversation context.
3. Browser reload restores the transcript for the persisted conversation ID.
4. A forced container shutdown and subsequent restart preserve completed history.
5. Two sessions remain isolated, including history retrieval and deletion.
6. Overlapping requests for one session are rejected without corrupting history.
7. Retrying the same request ID does not create duplicate completed turns.
8. Cancellation and timeout release the session without storing a successful draft.
9. Invalid input, malformed SSE, truncated streams, and OpenAI failures produce
   visible errors rather than success-shaped fallbacks.
10. Missing secrets fail clearly, and secret values do not reach the browser,
    repository, container image, or logs.
11. API requests reach the Worker rather than being answered by SPA fallback.
12. The protected deployment supports the same chat and persistence behavior
    verified locally.

Use focused tests and the project's typecheck, lint, and build commands. Verify a
real container request and a restart scenario; build success alone does not prove
runtime persistence or streaming behavior.

## Out of scope

- Live web search and verified source citations.
- Anthropic or multi-provider routing.
- File uploads and document retrieval.
- Parallel agent graphs and dynamic agent handoffs.
- Background jobs and durable resumption of interrupted agent runs.
- Multi-device conversation discovery.

Durable history is server-side, but the browser's stored session ID determines
which conversation it restores. Persistence does not promise continuation of an
in-flight run after a container failure.

## Cloudflare references

- [Container lifecycle and ephemeral disk](https://developers.cloudflare.com/containers/concepts/architecture/)
- [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Worker-first static asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Container limits and instance types](https://developers.cloudflare.com/containers/platform/limits/)
- [Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/)

Recheck current documentation and project-local types before implementation.
This document is a plan, not a claim that the scaffold is implemented or validated.
