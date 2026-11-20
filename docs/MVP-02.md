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