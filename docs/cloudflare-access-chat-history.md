# Cloudflare Access chat history setup

Protect the entire application and `/api/*` routes with a Cloudflare Access
application. Add an allow policy containing only the selected Cloudflare
account users who may use chat.

Set these Worker variables in `wrangler.json` or environment-specific
configuration:

- `CF_ACCESS_TEAM_DOMAIN`: the Cloudflare Access team domain, for example
  `example.cloudflareaccess.com`.
- `CF_ACCESS_AUDIENCE`: the audience identifier shown for the protected Access
  application.

The Worker verifies the `Cf-Access-Jwt-Assertion` signature, issuer, audience,
expiry and subject. The subject becomes the stable chat-history owner. Browser
identity headers and session UUIDs are not authentication.

The existing D1 `DB` binding is authoritative for conversation catalogues and
chat transcripts. Completed exchanges are synchronised to D1 before terminal SSE
success. The Durable Object remains the request-replay and in-flight run store,
and repairs pending D1 revisions before replay or history reload. D1 reads filter
by the verified Access subject.

Apply the chat migration locally and remotely before deployment:

```sh
pnpm exec wrangler d1 migrations apply DB --local
pnpm exec wrangler d1 migrations apply DB --remote
pnpm run deploy
```
