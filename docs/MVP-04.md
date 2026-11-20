Phase four tasks

- [ ] Replace the starter demo with a transcript, prompt composer, agent progress,  container-startup indicator, cancel action, and new-conversation action.
- [ ] Persist the conversation UUID locally and restore server-side history on reload.
- [ ] Use relative API paths and POST `fetch` streaming, rather than native `EventSource`, for chat requests.
- [ ] Define a typed SSE contract shared by the public API and frontend, with Python models representing the same event shapes.
- [ ] Parse SSE across arbitrary network chunk boundaries and handle malformed frames  and unexpected stream termination explicitly.
- [ ] Release stream readers and abort requests on cancellation, conversation change,  and component unmount.
- [ ] Keep cancelled or failed drafts distinguishable from completed stored messages.

## Completion criterion

users can submit, watch progress, cancel, reload, and continue a conversation without duplicate messages.