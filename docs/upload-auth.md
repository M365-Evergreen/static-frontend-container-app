\*\*Yes — if you bypass `/api/*`, you need your own check. "Only for authenticated users" is currently a property of Access, not of the Worker.\*\*

The Worker has no independent notion of who the user is. Its entire auth model is one line:

\`\`\`js

const token = request.headers.get("Cf-Access-Jwt-Assertion");

if (!token) return accessDenied("missing\_access\_jwt", 401);

\`\`\`

That header is injected by Access when Access processes the request. Bypass the path and the header never arrives — so every `/api/*` call returns `401 missing_access_jwt`. The Worker would be *less* protected than you think, not equally protected, because the thing doing the protecting was Access all along.

\*\*But you may not need to bypass at all.\*\* There's a fix that adds no auth and no dashboard change:

\*\*Retry the `PUT` once on a `405` with `method_not_allowed`.\*\*

Here's why it works. The redirect chain is: `PUT` → `302` → Access login → `302` back → `GET` → `405`. By the time you get that `405`, Access has already \*\*refreshed the `CF_Authorization` cookie\*\* — that's what the login hop did. So an immediate retry of the same `PUT`, with the same `Blob` still in hand, sails straight through with no redirect.

In `saveBucketEntry`:

\`\`\`ts

let response = await send();

if (response.status === 405) {

  const body = await response.clone().json().catch(() =&gt; null);

  if (body?.error?.code === "method\_not\_allowed") {

```
response = await send();   // session was just refreshed by the redirect
```

  }

}

\`\`\`

Two caveats worth knowing:

\- If the \*\*IdP session\*\* is also expired, the redirect goes to a cross-origin login page and the `fetch` fails with a CORS/network error rather than a `405`. So keep a "reload to sign in" fallback for that case.

\- It costs one wasted round-trip per expired session — negligible.

\*\*So, ranked:\*\*

1\. \*\*Retry-on-405\*\* — no new auth, no Access change, no security regression. Fixes the symptom completely for the common case.

2\. \*\*Bypass + Worker-issued cookie\*\* — the structurally correct fix, but it *is* additional auth, and it's real work.

3\. \*\*Bypass with nothing\*\* — makes the bucket writable by anyone. Don't.

Given your Worker is deliberately single-user and Access already gates everything, option 1 is the right call. Want me to write the full `saveBucketEntry` with the retry folded in, including the abort-signal and `FileConflictError` handling preserved?


Here's the complete replacement — drop it in over the existing `saveBucketEntry`. No change needed in `DocumentActions.tsx`.

\`\`\`ts

function isMethodNotAllowed(payload: unknown): boolean {

  return (

    typeof payload === "object" &amp;&amp;

    payload !== null &amp;&amp;

    "error" in payload &amp;&amp;

    typeof payload.error === "object" &amp;&amp;

    payload.error !== null &amp;&amp;

    "code" in payload.error &amp;&amp;

    payload.error.code === "method\_not\_allowed"

  );

}

export async function saveBucketEntry(

  key: string,

  content: Blob | null,

  signal: AbortSignal,

  etag?: string,

): Promise&lt;FileSummary&gt; {

  const folder = content === null;

  const invalidKey = fileKeyError(key, folder);

  if (invalidKey) throw new Error(invalidKey);

  const url = `/api/files/${folder ? "folder" : "upload"}?${new URLSearchParams({ key })}`;

  const send = () =&gt;

    fetch(url, {

      method: folder ? "POST" : "PUT",

      headers: {

        ...(!folder

          ? { "Content-Type": content.type || "application/octet-stream" }

          : {}),

        ...(etag ? { "If-Match": etag } : {}),

      },

      ...(content === null ? {} : { body: content }),

      signal,

      cache: "no-store",

    });

  let response = await send();

  // Cloudflare Access intercepts a request whose session has expired with a

  // 302 to the login page. The browser replays it as a GET, so the Worker sees

  // the wrong method and answers 405 method\_not\_allowed. That redirect has just

  // refreshed the CF\_Authorization cookie, so a single retry goes straight

  // through. Retry exactly once — never loop.

  if (response.status === 405) {

    const body: unknown = await response.clone().json().catch(() =&gt; null);

    if (isMethodNotAllowed(body)) {

      signal.throwIfAborted();

      response = await send();

    }

  }

  if (response.status === 409 &amp;&amp; !folder) {

    const payload: unknown = await response.json();

    if (

      typeof payload === "object" &amp;&amp;

      payload !== null &amp;&amp;

      "error" in payload &amp;&amp;

      typeof payload.error === "object" &amp;&amp;

      payload.error !== null &amp;&amp;

      "message" in payload.error &amp;&amp;

      typeof payload.error.message === "string" &amp;&amp;

      "etag" in payload.error &amp;&amp;

      typeof payload.error.etag === "string"

    ) {

      throw new FileConflictError(payload.error.message, payload.error.etag);

    }

    throw new Error(

      "The file changed during this operation. Review the bucket and try again.",

    );

  }

  if (!response.ok) throw new Error(await readApiError(response));

  const payload: unknown = await response.json();

  if (

    typeof payload !== "object" ||

    payload === null ||

    !("file" in payload) ||

    !fileSummary(payload.file) ||

    payload.file.key !== key

  ) {

    throw new Error(

      "The server returned an invalid saved file. Refresh the bucket before retrying.",

    );

  }

  return payload.file;

}

\`\`\`

**What changed and why**

\- The `fetch` call is hoisted into `send()` so the retry reuses the identical method, headers, `If-Match`, and body. The `Blob` is re-readable, so replaying it is safe.

\- `response.clone()` on the 405 branch is deliberate: if the body turns out *not* to be `method_not_allowed`, control falls through to `readApiError(response)` and the original body must still be unread.

\- `signal.throwIfAborted()` sits between the two attempts, so cancelling the upload mid-redirect still aborts cleanly instead of firing a second request.

\- Retry is capped at one. If the second attempt also returns 405, it falls through to `readApiError` and surfaces the real message rather than looping.

**What to verify**

1\. Upload a file with a **fresh** session — should succeed on the first attempt, no retry.

2\. Let the Access session expire (or clear `CF_Authorization`), then upload — you should see the 405, then a second request that returns `201`.

3\. Cancel an upload mid-flight — the abort should still land in `run()`'s catch block with `active.signal.aborted` true.

One thing this deliberately does *not* fix: if your **IdP** session is also expired, the redirect goes to a cross-origin login page and the `fetch` fails with a CORS/network error instead of a 405, so the retry never triggers. That case still needs a "reload to sign in" prompt — worth adding to `run()`'s catch as a distinct message if you see it in practice.