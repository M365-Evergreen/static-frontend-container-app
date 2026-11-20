# Project architecture

React + Vite + TypeScript SPA, a Cloudflare Worker gateway, and a Python 3.12
FastAPI backend in Cloudflare Containers.

The current frontend is a starter demo and the backend emits simulated agent
steps. Durable history and real OpenAI agents are planned in
`docs/mvp-implementation-plan.md`; do not describe them as implemented.

## Directory structure

- `src/react-app/`: React + TypeScript frontend.
- `src/worker/index.ts`: Worker router and exported `AgentContainer` class.
- `agents/`: FastAPI application and Python dependency manifest/lock.
- `container/Dockerfile`: Multi-stage Python 3.12 + uv image.
- `wrangler.json`: Worker, assets, container, and SQLite DO bindings.
- `vite.config.ts`: React plugin followed by the Cloudflare Vite plugin.

## Conventions

- Use pnpm and `pnpm-lock.yaml` for JavaScript dependencies; preserve pinned
  versions unless an upgrade is explicitly required.
- Use uv and `agents/uv.lock` for Python dependencies. Locked installations must
  fail on errors, never fall back to a different dependency set.
- Route session requests with `getContainer(env.AGENT_CONTAINER, sessionId)`.
  Send `x-session-id` on every conversation API request.
- Keep `sleepAfter = "10m"` and Uvicorn listening on `0.0.0.0:8080`, matching
  `defaultPort = 8080`.
- Container memory and disk are ephemeral. Persist completed history in Durable
  Object storage when implementing the durable-session phase.
- Expose the container's `GET /health` as `{"status": "ok"}`.
- Use Pydantic v2 models and async clients for agent inputs and execution.
- Bound agent calls with `max_turns`; the scaffold defaults to 5.
- Stream typed SSE events matching the public API contract in `README.md`.
- Clean up frontend fetch/stream readers with `AbortController` on unmount.
- Pass `OPENAI_API_KEY` through the container's `envVars`; never bake secrets into
  an image, source code, or logs.
- Generate binding/runtime types with Wrangler; never hand-edit
  `worker-configuration.d.ts`.

## Commands

- Install: `pnpm install --frozen-lockfile`.
- Develop: `pnpm run dev` (Docker must be running).
- Typecheck all TypeScript projects: `pnpm run typecheck`.
- Lint: `pnpm run lint`.
- Build frontend and Worker: `pnpm run build`.
- Generate bindings: `pnpm run cf-typegen`.
- Deploy after account/access review: `pnpm run deploy`.
- Python checks: `uv run --project agents --locked ruff check agents` and
  `uv run --project agents --locked ruff format --check agents`.
