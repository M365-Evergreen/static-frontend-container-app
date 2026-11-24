# Project architecture

React + Vite + TypeScript SPA, a Cloudflare Worker gateway, and a Python 3.12
FastAPI backend in Cloudflare Containers.

The frontend is the streaming chat UI. The backend runs real sequential agents
using an explicitly configured Gemini or NVIDIA-hosted model, and the Worker
implements durable history and request coordination.
Deployment access hardening is the remaining account-policy prerequisite documented
in `docs/MVP-05.md`.

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
- Container memory and disk are ephemeral. The Durable Object is authoritative:
hydrate each Python run from stored history and commit completed exchanges and
request IDs atomically before forwarding terminal SSE success.
- Require UUID `x-session-id` and `x-request-id` for chat submissions. Do not
restore shared defaults, query-string IDs, or authoritative client history.
- Expose the container's `GET /health` as `{"status": "ok"}`.
- Use Pydantic v2 models and async clients for agent inputs and execution.
- Run exactly three sequential agents. `max_turns` defaults to 5 and must be from
3 to 10; do not restore partial-pipeline success or automatic SDK retries.
- Require explicit `LLM_PROVIDER` (`gemini` or `nvidia`) and `LLM_MODEL`; do not
prefer a provider, supply an implicit model, or fall back to another provider.
Keep Gemini requests stateless with `store=False` and disable SDK continuation.
- With `KNOWLEDGE_MCP_URL`, run one bounded Cloudflare AI Search MCP lookup after
planning and before research. Send only the current prompt, never history or
model credentials. Supply retrieved chunks as untrusted evidence to research
and synthesis; preserve exactly three model calls and explicit retrieval failures.
Label empty searches honestly. General web browsing and execution remain unavailable.
- Stream typed SSE events matching the public API contract in `README.md`.
- Clean up frontend fetch/stream readers with `AbortController` on unmount.
- Pass the selected provider's `LLM_API_KEY` through the container's `envVars`;
never bake secrets into an image, source code, or logs.
- Generate binding/runtime types with Wrangler; never hand-edit
`worker-configuration.d.ts`.

## Commands

- Install: `pnpm install --frozen-lockfile`.
- Develop: `pnpm run dev` (Docker must be running).
- Typecheck all TypeScript projects: `pnpm run typecheck`.
- Lint: `pnpm run lint`.
- Worker regressions: `pnpm run test:worker` (Node 22.13+ with SQLite support).
- Build frontend and Worker: `pnpm run build`.
- Generate bindings: `pnpm run cf-typegen`.
- Deploy after account/access review: `pnpm run deploy`.
- Python checks: `uv run --project agents --locked ruff check agents` and
`uv run --project agents --locked ruff format --check agents`.
- Python regressions: `uv run --project agents --locked pytest agents/tests`.
- Real provider tests require explicit `RUN_LIVE_MODELS=true` opt-in and incur
charges; ordinary provider and MCP regression tests must use a mocked HTTP transport.

**Do not make changes to content in files when you make changes to th code.  Do not replace text wth your generated best effort placeholder**

**Use UK English**