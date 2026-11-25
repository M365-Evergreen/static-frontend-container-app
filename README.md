# Multi-Agent AI Application

React + Vite + TypeScript frontend, a Cloudflare Worker gateway, and a Python 3.12
FastAPI backend running in Cloudflare Containers.

**Current status:** the frontend and backend run real,
sequential planner, analyst/researcher, and synthesizer agents using explicitly
selected Gemini or NVIDIA-hosted models. No provider or model is preferred. Completed conversation
history and request deduplication are persisted in the session's Durable Object.
The researcher can retrieve evidence from a configured Cloudflare AI Search MCP
knowledge source before analysis.
The chat UI is implemented and deployment access hardening remains the final
account-policy prerequisite.

See [the MVP implementation plan](docs/mvp-implementation-plan.md) and
[phase one tasks](docs/MVP-01.md), [durable-session tasks](docs/MVP-02.md), and
[real-agent tasks](docs/MVP-03.md).

## Architecture

```text
React SPA (Workers Static Assets)
  |
  | /api/* with x-session-id
  v
Cloudflare Worker
  |
  | getContainer(env.AGENT_CONTAINER, sessionId)
  v
AgentContainer Durable Object
  |-- authoritative history, completed request IDs, active-run lease
  |
  | validated run payload with stored history
  v
FastAPI container on port 8080 -> selected model provider (stateless execution)
```

The Worker serves assets through `ASSETS` and routes `/api/*` to
`AGENT_CONTAINER` before SPA fallback. Requests with the same session UUID
address the same Durable Object and container.
Containers sleep after ten minutes of inactivity. Their memory and filesystem
are ephemeral. D1 stores authoritative conversation transcripts and catalogue
metadata. The Durable Object stores in-flight request coordination and also
supplies history to Python runs while synchronising completed exchanges to D1.

All conversation endpoints require a Cloudflare Access session and
`x-session-id`; there is no shared default or query-string alternative. UUIDs
identify conversations, not authenticated users. The Worker verifies the
Cloudflare Access JWT assertion and binds history to the verified Access subject.

## Project structure

```text
.github/                  Repository and scoped contributor instructions
agents/
  main.py                 FastAPI endpoints and provider-client lifespan
  orchestrator.py         Bounded sequential model calls and typed SSE events
  providers.py            Async Gemini and NVIDIA-hosted model adapters
  definitions.py          Planner, analyst, and synthesizer instructions
  knowledge.py            Bounded Cloudflare AI Search MCP retrieval
  models.py               Pydantic input, output, configuration, and event models
  limits.py               Input, output, deadline, and agent-call bounds
  errors.py               Sanitized provider/configuration errors
  tests/                  Backend and opt-in live Worker acceptance tests
  pyproject.toml          Python dependencies and development tools
  uv.lock                 Authoritative Python dependency lock
container/
  Dockerfile              Multi-stage, non-root Python runtime image
docs/                     MVP plan and phase tasks
src/
  react-app/              React + TypeScript streaming chat frontend
  worker/
    index.ts              Worker router and AgentContainer class
    session.ts            Run coordination, validation, cancellation, and streaming
    session-store.ts      SQLite history, leases, and atomic request deduplication
    session-stream.ts     Chunk-safe backend SSE parsing
tests/worker/             Worker session regression tests
.dockerignore             Restricts the image build context; excludes secrets
pnpm-lock.yaml            Authoritative JavaScript dependency lock
vite.config.ts            React and Cloudflare Vite plugins
worker-configuration.d.ts Generated Cloudflare runtime and binding types
wrangler.json             Worker, assets, container, and SQLite DO configuration
```

## Prerequisites

- Node.js 20.19+ in the 20.x line, or 22.12+.
- pnpm 12.18.0, as pinned in `package.json`; use pnpm rather than npm.
- Docker running with Linux containers.
- On Windows, WSL2 with Linux Node/pnpm and Docker integration is required for
  full-stack `pnpm run dev`. The installed Cloudflare Vite plugin does not support
  local container development from a native Windows process. Native Windows can
  still run the source checks, production build, and standalone Docker commands.
- uv for Python development. The Docker builder pins uv 0.11.29; no host uv or
  Python installation is needed for the full-stack Docker development path.
- A Cloudflare account with access to Containers for deployment.

JavaScript tooling versions are pinned to the existing scaffold lock versions,
not upgraded to the newest releases. Install pnpm using the
[official installation instructions](https://pnpm.io/installation) if needed.

## Local development

```powershell
pnpm install --frozen-lockfile
```

Create an ignored `.dev.vars` file beside `wrangler.json` containing `LLM_PROVIDER`,
`LLM_MODEL`, and `LLM_API_KEY`. The key must belong to the selected provider.
Do not commit or paste secret values into source or command arguments. The neutral
secret name is declared in `secrets.required` so type generation does not depend
on a local secret file. Chat requires valid provider configuration and may incur
usage charges. Missing or invalid configuration returns HTTP 503; there is no
provider/model fallback. Container `/health` remains available without a key.

Vite may copy `.dev.vars` into the ignored Worker build directory for local
preview. Never commit or upload those files as generic build artifacts; only
`dist/client` is the public static-assets directory. Docker's build context
excludes local secret files.

In a supported Linux/macOS shell (or WSL2 on Windows), with Docker running:

```powershell
pnpm run cf-typegen
pnpm run dev
```

Vite serves the frontend and runs the Worker locally. The first API request starts
the local container; frontend requests use relative `/api/*` paths.

## Model providers and execution limits

`LLM_PROVIDER` and `LLM_MODEL` are non-secret Wrangler variables, passed into the
container alongside the `LLM_API_KEY` secret. Both variables are intentionally
blank in `wrangler.json`: select them before deployment. No provider or model is
preferred, and requests never fall back to another provider when one fails.

| `LLM_PROVIDER` | Example `LLM_MODEL` from the repository | `LLM_API_KEY` |
| --- | --- | --- |
| `gemini` | `gemini-4-hydrogen` (also accepts a `models/` prefix) | Google Gemini API key |
| `nvidia` | `mistralai/mistral-large-4-1t-a52b` | NVIDIA API key |

Gemini uses the installed Google Gen AI SDK's asynchronous GenerateContent API.
NVIDIA-hosted models use `https://integrate.api.nvidia.com/v1/chat/completions`
through an async HTTP client; this is not the direct Mistral API. Model
availability and access depend on your provider account. `clairic.py` is empty
and does not yet define a provider integration.

To select the deployment provider/model, edit `vars.LLM_PROVIDER` and
`vars.LLM_MODEL` in `wrangler.json` and regenerate types. For local overrides,
set these variables in the ignored `.dev.vars` file, along with `LLM_API_KEY`.
Direct Python development reads the same three environment
variables; it does not automatically load the Worker's `.dev.vars`. Restart a
warm container after changing configuration.

Each run makes exactly three sequential model calls, with retries and SDK
continuation disabled and no provider-side tools. Gemini uses `store=False`; NVIDIA requests
have no provider-managed conversation chain. Each call receives authoritative completed
history, the current prompt, and all preceding agent results. When
`KNOWLEDGE_MCP_URL` is configured, one read-only MCP `search` runs after the planner
and before the researcher. Only the current prompt is sent to that endpoint, never
stored history or `LLM_API_KEY`. Retrieved chunks and their source metadata are
supplied to the researcher and synthesizer as untrusted evidence with `K1`, `K2`,
etc. citation identifiers. Source instructions must not override agent roles.

`vars.KNOWLEDGE_MCP_URL` in `wrangler.json` points to the supplied Cloudflare AI
Search `/mcp` endpoint. It is non-secret, uses HTTPS, and requires no authentication
on the current public endpoint. Direct Python development must set this environment
variable separately; `.dev.vars` can override it for Worker development. Set the
Worker variable to an empty string to disable retrieval, or leave it unset for
standalone Python. Restart warm containers after configuration changes.
Protect or disable the public endpoint before indexing sensitive content; see
[Cloudflare's MCP access guidance](https://developers.cloudflare.com/ai-search/api/search/mcp/).

Analysis and answers label knowledge-assisted versus model-only execution.
A successful search with no matching chunks explicitly reports that outcome and
continues with model knowledge; retrieval errors do not silently fall back.
Indexed knowledge is not live web verification. Code Mode, general browser/web
search, attachments, and command execution remain unavailable.

| Limit | Bound |
| --- | --- |
| Public JSON body | 128 KiB |
| Prompt | 8,000 Unicode code points |
| Stored history supplied to a run | 100 messages and 24,000 Unicode code points |
| Text context per model call, including instructions and earlier agent results | 50,000 Unicode code points |
| Output per agent | 1,024 output tokens and 8,000 Unicode code points including labels |
| Model request timeout | 30 seconds, no retries or automatic continuation |
| Knowledge search | One query; at most 5 chunks; no query rewrite or reranking |
| MCP response / retrieved context | 64 KiB per HTTP response / 12,000 Unicode code points |
| Knowledge lookup deadline | 10 seconds including MCP initialization and cleanup, within the pipeline deadline |
| Entire Python pipeline | 90 seconds |
| Worker run including container startup | 120 seconds |
| Agent-call budget | `max_turns` from 3 to 10; default 5; exactly 3 calls |

Input is not silently truncated and incomplete/token-limited provider responses
are not accepted as success. When stored history exceeds its limit, it remains
retrievable; start a new session rather than sending an oversized conversation.
Failed or cancelled runs never commit a completed exchange.

## Checks and build

```powershell
pnpm run typecheck
pnpm run lint
pnpm run test:worker
pnpm run build
```

Typechecking covers `tsconfig.app.json`, `tsconfig.node.json`,
`tsconfig.worker.json`, and `tsconfig.tests.json`. Worker tests use Node's built-in
test runner and SQLite; running them requires Node.js 22.13+ with `node:sqlite`
support. ESLint checks source and configuration; generated
Cloudflare declarations are excluded. Rerun `pnpm run cf-typegen` after binding,
secret-name, or compatibility configuration changes. Never edit generated
declarations manually.

The Vite build produces frontend assets in `dist/client` and a Worker deployment
bundle/configuration under `dist/paulibaby_agent`. Build output is
generated; edit `wrangler.json`, not the generated configuration.

For Python development:

```powershell
uv sync --project agents --locked --python 3.12
uv run --project agents --locked ruff check agents
uv run --project agents --locked ruff format --check agents
uv run --project agents --locked pytest agents/tests
```

After intentionally changing Python dependencies, regenerate `agents/uv.lock`
with `uv lock --project agents --python 3.12`. The image uses `uv sync --locked
--no-dev --no-install-project`; dependency installation errors fail the build.

## Standalone container

Run these commands from the repository root so the Docker build context includes
`agents`. The Worker configuration also sets `image_build_context` to the root.

```powershell
docker build --platform linux/amd64 -f container\Dockerfile -t paulibaby-agent:local .
docker run --rm -p 127.0.0.1:8080:8080 paulibaby-agent:local
```

The runtime runs as `appuser`, uses `/app/.venv/bin` for installed executables,
and listens on `0.0.0.0:8080`. From another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health
```

The Docker healthcheck probes that same endpoint. Stop the foreground container
with Ctrl+C when finished.

## Deployment

The configured Worker name is **`paulibaby-agent`**. Bindings are `ASSETS` and
`AGENT_CONTAINER` pointing to the exported
`AgentContainer` class; SQLite migration `v1` is retained.

Authenticate and verify the intended account:

```powershell
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Configure the selected provider's `LLM_API_KEY` through the Cloudflare dashboard or Wrangler's protected
interactive secret input. `wrangler secret put` creates a Worker version and
deploys immediately; do not treat it as a local-only setup command.

After checking account permissions, container capacity, secrets, and access
controls:

```powershell
pnpm run deploy
```

This builds the frontend and Worker, then deploys using Vite's generated
configuration. Wrangler builds and publishes the container image. Do not use
`pnpm dlx` or a global Wrangler to bypass the project's pinned version.

## API reference

### `GET /health`

Direct container readiness endpoint returning `{"status": "ok"}`. The Worker
currently forwards only `/api/*`, so `/health` on the frontend origin is not a
container health probe.

### `POST /api/chat`

Streams genuine agent outputs followed by durable completion as `text/event-stream`.

Headers:

```text
Content-Type: application/json
x-session-id: <session-uuid>
x-request-id: <request-uuid>
```

Request:

```json
{
  "prompt": "Analyze Cloudflare Containers",
  "max_turns": 5
}
```

The public payload accepts only `prompt` and `max_turns`. Both headers must be
UUIDs; their hexadecimal case is normalized. `sessionId` query parameters,
missing IDs, blank prompts, client-supplied history, and invalid limits return
HTTP 400. Size limits return HTTP 413. `max_turns` must be an integer from 3 to 10;
the default is 5 and exactly three agents run. Values below 3 are rejected before
any provider call rather than returning partial work. Only the Durable Object supplies internal
history and request metadata to Python.

Example SSE frames:

```text
data: {"turn": 1, "agent": "planner_agent", "status": "running", "output": "<planner result>"}

data: {"turn": 2, "agent": "research_agent", "status": "running", "output": "Knowledge-assisted analysis; indexed sources, not live web verification.\n\n<analysis>"}

data: {"turn": 3, "agent": "synthesizer_agent", "status": "running", "output": "Knowledge-assisted answer; indexed sources, not live web verification.\n\n<answer>"}

data: {"status": "done", "request_id": "<request-uuid>", "final_output": "...", "history_length": 2}

```

These knowledge-assisted labels apply when search returns matching chunks.
Without configured retrieval, outputs retain model-only labels; an empty search
uses `No matching knowledge sources; model-only analysis/answer.` labels.
No token-level or separate tool SSE events are added.

The completed user/assistant pair and request ID are committed atomically before
`done` is sent. Repeating the same request ID and input replays that stored `done`
event without executing Python or appending messages. Its `history_length`
describes the original completion, not any later turns. Reusing an ID with
different input returns HTTP 409.

Only one run may be active per session; overlapping submissions return HTTP 409.
Runs have a 120-second deadline including container startup. Failed or cancelled
runs store no completed messages and may be retried with the same request ID.
After an object failure, a persisted run lease expires by that deadline rather
than leaving the conversation permanently busy. In-flight runs are not resumed.

Startup failures return an HTTP error before streaming. Invalid/truncated backend
SSE, execution errors, cancellation, or timeout after streaming starts produce a
terminal error instead of `done`:

```text
data: {"status": "error", "code": "run_cancelled", "message": "The run was cancelled."}

```

Configuration, authentication, rate/quota, connectivity, provider timeout,
refusal, incomplete output, and pipeline deadline failures have explicit error
codes. Retrieval failures use `knowledge_error`, `knowledge_timeout`, or
`knowledge_limit`. Raw provider errors, credentials, prompts, and model outputs are not logged
by the application's operational error handlers. Only all three successful
stages followed by a valid completion can become stored history.

### `GET /api/history`

Requires `x-session-id`. Returns only that session's ordered completed messages:

```json
{
  "session_id": "<session-uuid>",
  "messages": [
    {"sequence": 1, "role": "user", "content": "...", "request_id": "<request-uuid>"},
    {"sequence": 2, "role": "assistant", "content": "...", "request_id": "<request-uuid>"}
  ]
}
```

History retrieval and chat responses use `Cache-Control: no-store`. Browser reload
and container restart do not remove these stored messages.

### `DELETE /api/history`

Requires `x-session-id`. Returns HTTP 204 after deleting the session's messages
and completed request IDs. It leaves other sessions and container lifecycle
storage untouched. An active run causes HTTP 409; cancel it first.

### `DELETE /api/chat`

Requires `x-session-id` and the active run's `x-request-id`. Returns HTTP 204 when
cancellation is requested, releases the reservation, and aborts the backend
stream. A non-active/mismatched request ID returns HTTP 409. Closing a client's
stream also propagates cancellation where the transport supports it; the
server-side deadline always bounds an abandoned run. Already committed exchanges
remain completed and are not undone by cancellation.

The chat frontend implements this contract and retains its session UUID locally
for history restoration after reload.

## Live session checks

Offline tests exercise both providers with intercepted native HTTP transports and do not incur
provider charges. With the local Worker running and a valid local key, explicitly
opt into the bounded live agent acceptance test (six model calls):

```powershell
$env:SESSION_API_BASE_URL = "http://127.0.0.1:5173"
$env:RUN_LIVE_MODELS = "true"
uv run --project agents --locked pytest agents/tests/test_live_agents.py
```

This verifies actual intermediate outputs and a follow-up that relies on the
previous completed turn. It uses only synthetic, non-sensitive prompts and
deletes its test history afterward.

The broader session stress tests incur additional provider calls and require
`RUN_LIVE_SESSION_STRESS=true` before running `agents/tests/test_live_sessions.py`.
They exercise retrieval, deduplication, isolation, deletion, overlap, and cancellation.
For the forced-restart scenario, also set `SESSION_TEST_SESSION_ID` to a disposable
test session UUID and `SESSION_CONTAINER_ID` to its exact local Docker container
ID or name. The test restarts only that container; never point it at production or
a container used by another session. Without that setting, it tests client reload
but does not restart a container.

Cloudflare agent tooling was assessed for this architecture; see
[phase two's tooling assessment](docs/MVP-02.md#cloudflare-agent-options).
