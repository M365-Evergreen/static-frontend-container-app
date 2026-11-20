---
applyTo: "agents/**/*,container/**/*"
---

# Containerized multi-agent rules

- Keep container images lean with a multi-stage build and a non-root runtime user.
- Bind the server to `0.0.0.0` on the Worker's declared `defaultPort`.
- Install dependencies from `agents/uv.lock` without development dependencies;
  fail the build when the lock and manifest disagree.
- Use structured orchestration and SSE progress events matching the public API.
- Handle shutdown cleanly and flush active-run logs before exit.
- Container memory and filesystem are ephemeral; durable history belongs in
  Durable Object storage, not a local SQLite file inside the container.
