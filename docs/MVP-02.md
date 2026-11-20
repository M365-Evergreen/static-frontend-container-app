<<<<<<< HEAD
# Phase two tasks

- [ ] Require a validated session UUID; remove shared default-session behaviour.
- [ ] Normalize any supported query-based ID into the canonical `x-session-id` header,  or remove that alternative from the public contract.
- [ ] Route every conversation to its corresponding Durable Object.
- [ ] Store ordered completed messages and request IDs in Durable Object storage.
- [ ] Add session-scoped history retrieval and deletion endpoints.
- [ ] Hydrate every Python run from authoritative stored history. Do not accept  client-supplied history as authoritative.
- [ ] Coordinate one active run per session and reject overlapping submissions.  
- [ ] Ensure interruption or timeout cannot leave a session permanently busy.
- [ ] Use request IDs for retry deduplication.

## Completion criterion

## browser reload and container restart preserve completed

turns, and separate sessions cannot read or influence one another.
=======
- [x] Require a validated session UUID; remove shared default-session behaviour.
- [x] Normalize any supported query-based ID into the canonical `x-session-id` header, or remove that alternative from the public contract.
- [x] Route every conversation to its corresponding Durable Object.
- [x] Store ordered completed messages and request IDs in Durable Object storage.
- [x] Add session-scoped history retrieval and deletion endpoints.
- [x] Hydrate every Python run from authoritative stored history. Do not accept client-supplied history as authoritative.
- [x] Coordinate one active run per session and reject overlapping submissions.
- [x] Ensure interruption or timeout cannot leave a session permanently busy.
- [x] Use request IDs for retry deduplication.

## Completion criterion

Browser reload and container restart preserve completed turns, and separate
sessions cannot read or influence one another.

## Implementation

- Kept the existing `AgentContainer` class, SQLite migration, pnpm/uv locks, and
  simulated Python pipeline. No additional bindings or agent framework.
- Require canonical UUID headers: `x-session-id` on every conversation endpoint,
  plus `x-request-id` on submission and cancellation. Removed query IDs and
  shared defaults; public inputs cannot include authoritative history.
- Store ordered user/assistant exchanges and completed request IDs in SQLite.
  Commit both atomically before terminal SSE success. Retries replay the original
  completion; conflicting input for an existing request ID returns HTTP 409.
- Added `GET /api/history`, `DELETE /api/history`, and `DELETE /api/chat`.
  Deletion is session-scoped, rejects active runs, and preserves Container
  lifecycle tables. UUID possession is not user authentication.
- Hydrate every stateless Python run from the Durable Object's history.
- Reserve one run per session with a token and persisted 120-second lease.
  Cancellation, stream interruption, timeout, and backend failure release the
  reservation; expired leases recover after object failure. Old attempt tokens
  cannot commit or clear a newer attempt.
- Parse backend SSE across chunk/UTF-8/CRLF boundaries. Malformed or truncated
  streams do not create completed messages. Forward explicit terminal errors.
- Route `/api/*` Worker-first so SPA fallback cannot mask conversation endpoints.
- Check container health before submitting a run. Retry only the pinned SDK's
  transient no-instance startup failure, within the run deadline; never
  automatically retry a submitted backend POST.

## Verification

- Frozen pnpm installation, generated binding freshness, full-project
  typechecking, zero-warning ESLint, frontend/Worker build, and Wrangler
  deployment dry-run including the locked Python container image.
- `pnpm run test:worker`: 16 focused regressions using real SQLite. Covered
  persisted history/replay, input rejection, isolation/deletion, overlapping
  startup, cancellation, startup/stream deadlines, stale leases/attempt tokens,
  malformed/truncated SSE, and transaction rollback on persistence failure.
- Locked Python 3.12 checks and five backend regressions for request-local
  authoritative history and typed internal input validation.
- Two live acceptance tests through an isolated WSL Worker and real Docker
  containers. Verified history using a new client, request replay, session
  isolation/deletion, overlap rejection, cancellation followed by retry, and a
  forced container restart followed by hydration of the earlier completed turn.

The phase-two completion criterion is satisfied at the API/storage level.
Browser transcript restoration remains part of the phase-four chat UI; this
phase verifies its history-retrieval contract with a new client. No remote
deployment was performed during phase-two implementation.

## Cloudflare agent options

The current implementation deliberately keeps orchestration in Python and
persistence in the existing Container Durable Object. These options were assessed
against current official documentation, not added as dependencies:

| Option | Potential use | Phase-two decision |
| --- | --- | --- |
| Agents SDK / Think | Durable agent identity, tool loops, scheduling, approvals, and MCP integration | Not required for completed-history storage; adopting it would change orchestration architecture. |
| Code Mode | Sandboxed JavaScript can compose multiple tool calls; requires Code Mode integration and a Worker Loader binding | Defer until there are real tools, a permission model, and execution limits. |
| Browser tools | Browser automation and extraction using Browser Run/CDP | Defer; adds a browser binding, external-content risks, and costs beyond model-only analysis. |
| Agent Skills | Load reusable instructions, references, and optional scripts on demand | Consider for specialized real agents; experimental APIs should be pinned and script execution separately controlled. |
| Web search / MCP tools | Live source retrieval and remote tool integrations | Not enabled: the confirmed MVP is model-only research. Requires an explicit scope decision, provider/access configuration, and citation verification. |

Sources:
[Agents overview](https://developers.cloudflare.com/agents/),
[Think tools, Code Mode, browser and MCP integration](https://developers.cloudflare.com/agents/harnesses/think/tools/),
[Agent Skills](https://developers.cloudflare.com/agents/skills/),
[SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)
