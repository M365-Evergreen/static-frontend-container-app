---
applyTo: "agents/**/*.py,container/**/*"
---

# Python FastAPI and multi-agent rules

- Use Python 3.12+ type hints and Pydantic v2 models.
<<<<<<< HEAD
- Isolate session state with an async-safe store and a lock per session.
=======
- Keep run context request-local. The Durable Object coordinates one active run
  per session and supplies authoritative history; do not add a Python history
  store or accept browser history as authoritative.
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)
- Use async endpoints and non-blocking LLM/HTTP clients.
- Handle shutdown cleanly in FastAPI lifespan hooks. Completed durable history
  must not depend on a shutdown-time flush of container memory.
- Keep images small using uv and `python:3.12-slim`.
