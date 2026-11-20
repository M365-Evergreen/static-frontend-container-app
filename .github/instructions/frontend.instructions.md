---
applyTo: "src/react-app/**/*.{ts,tsx}"
---

# React + Vite + TypeScript frontend rules

- Use strict TypeScript and type all API payloads and SSE frames.
- Fetch backend endpoints using relative `/api/*` paths; never hardcode local
  backend ports in frontend code.
- Handle streaming responses with `AbortController` cleanup in an effect or
  custom hook.
- Surface intermediate agent states, tool execution status, and container
  cold-start loading indicators when implementing the chat UI.
