# Microsoft Entra chat history setup

Chat and its history now require Microsoft Entra sign-in. Files and browser tools
keep their existing access behaviour. No client secret is needed or accepted by
the SPA.

## Complete the app registration

The supplied single-tenant registration has application/client ID
`7ea67f3b-a85c-4427-855a-578c168edc27`. Its object ID is not a client ID.

1. Copy the directory/tenant ID into `ENTRA_TENANT_ID` in `wrangler.json`.
   It is deliberately unset until a real tenant is configured.
2. In **Expose an API**, set the application ID URI to
   `api://7ea67f3b-a85c-4427-855a-578c168edc27` and add the delegated
   `Chat.Access` scope. Grant consent according to your tenant's policy.
3. Set `api.requestedAccessTokenVersion` to `2` in the app manifest. The Worker
   accepts v2 delegated access tokens, not ID tokens or Microsoft Graph tokens.
4. In **Authentication**, register each app origin's exact `/redirect.html` URL
   under **Single-page application**, including the local Vite origin if needed.
   The existing `paulibaby.cloudflareaccess.com/cdn-cgi/access/callback` URI is
   for Cloudflare Access and does not replace this SPA callback. The bridge page
   must not have a `Cross-Origin-Opener-Policy` header.
5. Keep implicit grants disabled. The browser uses MSAL's authorisation-code
   flow with PKCE. If you separate the SPA and API registrations, update
   `ENTRA_CLIENT_ID`, `ENTRA_API_AUDIENCE`, `ENTRA_API_SCOPE` and the delegated
   API permissions/consent to match.

The other three Entra variables are already set for this registration and scope.
Local overrides can be placed in an ignored `.dev.vars` file. Regenerate bindings
with `pnpm run cf-typegen` after changing Worker variables.

## Database and deployment

The existing D1 `DB` binding is reused. The additive migration creates
`chat_conversations` and `chat_messages`; the full schema also remains in
`schema.sql`, alongside the existing files and commands tables.

```sh
pnpm exec wrangler d1 migrations apply DB --local
```

After the Entra registration and deployment-access review are complete, apply
the same migration remotely before deploying:

```sh
pnpm exec wrangler d1 migrations apply DB --remote
pnpm run deploy
```

These remote commands are operator steps; adding this integration does not
configure Entra, migrate the live database or deploy the Worker automatically.

## Ownership and recovery

The Worker verifies the token's signature, tenant-specific issuer, audience,
expiry, authorised SPA client and delegated scope. Ownership uses the verified
tenant and object IDs, not an email address or a client-supplied identity.
Every chat/history operation enforces ownership. Anonymous conversations remain
unclaimed and are not listed or automatically imported.

Durable Object SQLite remains authoritative for request deduplication and
history hydration. Each completed exchange and its pending D1 revision are
committed together. D1 receives a transactionally replaced, version-guarded
snapshot before terminal SSE success. If D1 fails, the reply remains saved in
the Durable Object and an explicit error is returned. **Reload history** retries
the durable pending revision, including after object restart, without another
model run. Request replay also repairs pending history first.

Deleting/resetting a conversation likewise keeps a pending empty revision until
D1 confirms it. Empty conversation metadata is retained as a version/ownership
tombstone but is excluded from the sidebar. A failed reset must be retried or
reconciled by reloading history before assuming D1 has been cleared.

The sidebar lists only the signed-in user's nonempty conversations, with
pagination and links to resume them. **New chat** creates another UUID rather
than deleting the previous conversation. Switching conversations or accounts
aborts frontend requests and clears the displayed draft and transcript.
