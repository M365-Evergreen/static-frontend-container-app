---
applyTo: "src/worker/**/*.ts,wrangler.json,vite.config.ts"
---

# Cloudflare Worker and Containers rules

- Target the Workers runtime using Web Standard APIs; do not use Node `fs` or
  `child_process` in Worker code.
- Import `Container` and `getContainer` from `@cloudflare/containers`.
- Export `AgentContainer` as a named class matching `class_name` in
  `wrangler.json`, and type its environment using generated bindings.
- Pass the selected provider's `LLM_API_KEY` into the container through `envVars`;
  never bake secrets into the Dockerfile.
- Place `cloudflare()` after `react()` in the Vite plugins array.
- Keep the container image build context at the repository root so `agents/` is
  available to `container/Dockerfile`.
