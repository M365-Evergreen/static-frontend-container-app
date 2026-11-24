# Phase one tasks

- [x] Select one package manager and reconcile the manifest and its authoritative lockfile without silently upgrading dependencies. Prefer pnpm unless npm is more stable.
- [x] Make typechecking cover the frontend, Vite configuration, and Worker projects.
  - [x] Avoid linting errors, including implicit or unexpected `any`.
- [x] Restore appropriate lint scripts and their declared dependencies.
- [x] Regenerate Cloudflare binding types from the actual configuration.
  - [x] Ask for binding details before generation.
- [x] Fix the container dependency installation and runtime executable environment.
- [x] Use a reproducible Python dependency lock, remove the success-shaped install fallback, and retain a lean, non-root Python 3.12 image.
- [x] Make the healthcheck target `http://127.0.0.1:8080/health` and keep Uvicorn bound to `0.0.0.0:8080`.
- [x] Correct documentation formatting, paths, and build/deployment instructions.

Prefer preserving `src\react-app` over an unnecessary directory migration.

## Completion criterion

The frontend and Worker build successfully, and the container starts with a
responsive health endpoint.

## Implementation

- Selected pnpm 12.18.0 and `pnpm-lock.yaml`; removed the competing npm lockfile.
  Pinned direct JavaScript tooling to the versions already present in the
  scaffold's lockfiles, with `@cloudflare/containers` 0.0.25.
- Changed typechecking to `tsc -b` so all three referenced projects are checked.
  Restored ESLint dependencies and a zero-warning lint command.
- Confirmed `ASSETS`, `AGENT_CONTAINER` -> `AgentContainer`, SQLite migration
  `v1`, and Worker name `paulibaby-agentr`. Declared only
  `OPENAI_API_KEY` and regenerated Cloudflare types.
- Added `agents/uv.lock`, removed unused Anthropic support, and changed the backend
  to a uv-managed application rather than an installed Python distribution.
- Added a locked multi-stage Docker build, digest-pinned base/uv images,
  a non-root runtime, and the correct virtualenv executable path and healthcheck.
  The Docker build context is explicitly the repository root and excludes local
  environments, caches, and secret files.
- Preserved `src\react-app`, corrected build output to `dist/client` and
  `dist/static_frontend_container_appr`, and repaired README/contributor
  documentation.

## Verification

- `pnpm install --frozen-lockfile`
- `pnpm run cf-typegen`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run build`
- `pnpm exec wrangler deploy --dry-run`
- `uv lock --project agents --check --python 3.12`
- `uv run --project agents --locked ruff check agents`
- `uv run --project agents --locked ruff format --check agents`
- Built the final Linux/amd64 image and verified Docker reports it healthy,
  `GET /health` returns `{"status":"ok"}`, the process runs as UID 10001 using
  `/app/.venv`, and the existing simulated SSE endpoint works. Warm-session
  history was also checked across two requests.

The completion criterion is satisfied. No remote deployment was performed.

Full-stack `pnpm run dev` was attempted but the installed Cloudflare Vite plugin
explicitly rejects native Windows container development. Use WSL2 with Linux
Node/pnpm and Docker integration; this platform requirement is now documented.
Worker-to-container streaming through the local Vite server remains unverified
in a supported shell. Standalone Docker health/SSE and production packaging
were verified.

These verification notes describe the original simulated scaffold. The current
backend requires explicit provider/model selection and the selected provider's
`LLM_API_KEY`; see the [current setup](../README.md#model-providers-and-execution-limits).
There is no default provider or model. No secret values were added.