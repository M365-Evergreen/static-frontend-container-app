# Multi-Agent AI Application

React + Vite + TypeScript frontend, a Cloudflare Worker gateway, and a Python 3.12
FastAPI backend running in Cloudflare Containers.

**Current status:** the frontend is a starter demo and the backend streams
simulated planner, researcher, and synthesizer steps. OpenAI integration, the chat
UI, and durable conversation history are planned, not implemented. Python session
memory currently survives only while its container stays warm.

See [the MVP implementation plan](docs/mvp-implementation-plan.md) and
[phase one tasks](docs/MVP-01.md).

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
AgentContainer Durable Object -> FastAPI container on port 8080
```

The Worker serves assets through `ASSETS` and forwards `/api/*` to
`AGENT_CONTAINER`. Requests with the same session ID address the same container.
Containers sleep after ten minutes of inactivity. Their memory and filesystem
are ephemeral; the SQLite-backed Durable Object binding does not automatically
persist Python state.

The scaffold accepts a session ID from `x-session-id` or a `sessionId` query
parameter and otherwise uses `default-session`. Until session validation is
implemented, always send a unique `x-session-id` header: query-only IDs are not
currently forwarded to Python. This scaffold is not ready for a public paid-model
endpoint.

## Project structure

```text
.github/                  Repository and scoped contributor instructions
agents/
  main.py                 FastAPI health endpoint and simulated SSE chat
  pyproject.toml          Python dependencies and development tools
  uv.lock                 Authoritative Python dependency lock
container/
  Dockerfile              Multi-stage, non-root Python runtime image
docs/                     MVP plan and phase tasks
src/
  react-app/              React + TypeScript starter frontend
  worker/
    index.ts              Worker router and AgentContainer class
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

Create an ignored `.dev.vars` file beside `wrangler.json` containing your local
`OPENAI_API_KEY`. Do not commit or paste secret values into source or command
arguments. The secret name is declared in `secrets.required` so type generation
does not depend on a local secret file. The current simulated pipeline does not
call OpenAI; missing local secrets may produce a development warning.

In a supported Linux/macOS shell (or WSL2 on Windows), with Docker running:

```powershell
pnpm run cf-typegen
pnpm run dev
```

Vite serves the frontend and runs the Worker locally. The first API request starts
the local container; frontend requests use relative `/api/*` paths.

## Checks and build

```powershell
pnpm run typecheck
pnpm run lint
pnpm run build
```

Typechecking covers `tsconfig.app.json`, `tsconfig.node.json`, and
`tsconfig.worker.json`. ESLint checks source and configuration; generated
Cloudflare declarations are excluded. Rerun `pnpm run cf-typegen` after binding,
secret-name, or compatibility configuration changes. Never edit generated
declarations manually.

The Vite build produces frontend assets in `dist/client` and a Worker deployment
bundle/configuration under `dist/static_frontend_container_appr`. Build output is
generated; edit `wrangler.json`, not the generated configuration.

For Python development:

```powershell
uv sync --project agents --locked --python 3.12
uv run --project agents --locked ruff check agents
uv run --project agents --locked ruff format --check agents
```

After intentionally changing Python dependencies, regenerate `agents/uv.lock`
with `uv lock --project agents --python 3.12`. The image uses `uv sync --locked
--no-dev --no-install-project`; dependency installation errors fail the build.

## Standalone container

Run these commands from the repository root so the Docker build context includes
`agents`. The Worker configuration also sets `image_build_context` to the root.

```powershell
docker build --platform linux/amd64 -f container\Dockerfile -t static-frontend-container-app:local .
docker run --rm -p 127.0.0.1:8080:8080 static-frontend-container-app:local
```

The runtime runs as `appuser`, uses `/app/.venv/bin` for installed executables,
and listens on `0.0.0.0:8080`. From another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health
```

The Docker healthcheck probes that same endpoint. Stop the foreground container
with Ctrl+C when finished.

## Deployment

The configured Worker name is **`static-frontend-container-appr`**, including the
trailing `r`. Bindings are `ASSETS` and `AGENT_CONTAINER` pointing to the exported
`AgentContainer` class; SQLite migration `v1` is retained.

Authenticate and verify the intended account:

```powershell
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Configure `OPENAI_API_KEY` through the Cloudflare dashboard or Wrangler's protected
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

Streams simulated agent steps as `text/event-stream`.

Headers:

```text
Content-Type: application/json
x-session-id: <session-uuid>
```

Request:

```json
{
  "prompt": "Analyze Cloudflare Containers",
  "max_turns": 5
}
```

The current backend accepts `max_turns` from 1 to 10, defaults to 5, and executes
at most the three placeholder agents.

Example SSE frames:

```text
data: {"turn": 1, "agent": "planner_agent", "status": "running", "output": "..."}

data: {"status": "done", "final_output": "...", "history_length": 2}

```

The starter frontend's `/api/` demo does not implement this chat contract; the chat
UI belongs to a later MVP phase.
