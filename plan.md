# Agent UI refactor implementation plan

## Agreed scope

Refactor the frontend using `docs/react-app/Ui/chat.md` as the interaction and layout reference, not as a package-installation recipe or scripted AI transport. Keep the real relative `/api/*` endpoints and typed SSE transport.

The user selected frontend-only scope. Photos & Files, Deep Research, Web Search, and command execution remain visible as explicitly unavailable capabilities. Do not implement backend tools, fake execution, fabricated citations, scripted replies, or private model reasoning. Keep the three sequential agents and existing request/session contracts unchanged.

## Existing integration and conventions

- `Agent.tsx` currently contains API coordination, state, and all rendering.
- HomePage currently renders the separate unfinished `components/ChatBox.tsx`, not Agent.
- AppShell already owns the main landmark. Agent should render a labelled section, not another main.
- `main.tsx` already imports `styles/tokens.css`, `styles/reset.css`, and `styles/layout.css`.
- Components typically use `components/Name/Name.tsx`, named exports, and colocated styling; some existing wrappers use React Aria Components.
- Use existing base tokens and CSS modules for overrides, without Tailwind, shadcn generation, or introducing the AI SDK demo transport.
- Export nontrivial component props from colocated `Name.types.ts` files and import them with `import type`. Keep shared domain/API types separate from presentation props.
- Preserve existing uncommitted work; only retire ChatBox and its dedicated styles after verifying they are no longer used.

## Implementation sequence

### 1. Extract chat domain and coordination

Create `chat/chat.types.ts`, `chat/chat.api.ts`, and `hooks/useAgentChat.ts`.

Move StoredMessage, history payloads, draft/run state, session helpers, and API error handling out of Agent. Continue to use `sse.ts` as the typed stream parser. Return narrowly scoped state and actions rather than passing the entire controller through every component.

Represent history loading/error, ready, submitting, running, cancelling, cancelled, failed, and resetting explicitly. Validate API payloads at the boundary. Validate persisted session IDs against the required UUID contract and handle local storage failures visibly.

Own AbortControllers for history, submission, cancellation, and reset; clean up on unmount and session changes. Guard late callbacks so a previous request cannot update a new session. Honor the reader's abort signal and cancel/release readers reliably.

Check DELETE responses and display failures instead of swallowing them. Cancel an active request before clearing history, and do not claim reset or cancellation succeeded without confirmation. Reconcile history on ambiguous completion/cancellation races so an already committed exchange is not labelled unpersisted.

Only add completed exchanges after a matching terminal done event. Keep failed/cancelled attempts distinct from stored history. Retain max_turns=5 and all required UUID headers.

### 2. Build the composed Agent

Keep `Agent.tsx` as orchestration/composition and `Agent.module.css` as shell layout overrides.

Add focused component folders:

- AgentHeader: thread title, honest description, reset icon button and tooltip.
- AgentEmptyState: icon, heading, and guidance matching actual model-only capabilities.
- MessageScroller: viewport, user-turn anchoring, live-edge following, and return-to-latest control.
- ChatMessage: right-aligned user bubble and left-aligned assistant content.
- AgentTrace: collapsible planner/researcher/synthesizer steps with pending, active, completed, failed, and cancelled status.
- Markdown: safe prose, lists, inline code, and fenced blocks without executing raw HTML.
- CodeBlock: readable, selectable code/tool-output presentation with constrained overflow.
- AgentComposer: labelled multiline field, context menu, send/stop actions, and input validation.
- ContextMenu: visible unsupported actions and accessible capability explanations.

Use semantic HTML for transcript/messages and installed React Aria primitives for menu, tooltip, disclosure, field, and icon-button interactions. Reuse existing Form, Button, and ProgressCircle where their APIs fit; do not refactor unrelated shared components to match a different API.

Do not render agent summaries as private thoughts. Current running frames arrive after each agent finishes, not as token deltas or agent-start frames. Show connection/waiting status before the first frame and completed step output as it arrives; infer the next queued stage honestly. Do not claim measured cold-start status or real token streaming. History contains final message text only, so do not reconstruct missing traces on reload.

Provide a visible explanation that tool execution is unavailable, not a fake ToolRow. Unsupported menu items should be disabled with a readable capability note available to keyboard/screen-reader users; do not depend on hovering disabled items.

### 3. Implement composer and scrolling behavior

Enter submits; Shift+Enter inserts a newline; IME composition does not submit. Prevent empty and duplicate sends and enforce the backend's 8,000 Unicode-code-point prompt bound without silently truncating. Show stop during active execution and a distinct cancelling state.

Anchor a newly submitted user message near the top, reserving space for the incoming answer. Follow arriving content only while the reader is at the live edge; never steal scroll position when reviewing older messages. Observe content/viewport size changes and provide return-to-latest navigation. Keep historical loading separate from new-send anchoring.

Use reduced-motion-aware CSS rather than adding an animation dependency. Avoid live-announcing the entire growing transcript; announce concise run status changes and errors. Ensure accessible labels, focus management, visible focus rings, and touch-target sizing.

### 4. Integrate and style

Render Agent from HomePage in place of the sample count, search, and ChatBox content. Preserve AppRouter, AboutPage, and AppShell navigation.

Fit Agent inside the existing AppShell rather than imposing another 100vh panel beneath its header/footer. Keep the composer reachable and the transcript as the bounded scrolling area. Support small screens, virtual keyboards, long URLs/code, and large text.

Use the existing color, spacing, type, border, and focus tokens. Keep base global styles intact; all chat-specific overrides live in CSS modules. Use React Aria state attributes for interactive styling.

If required for safe Markdown rendering, select maintained React Markdown/GFM dependencies and update package.json/pnpm-lock.yaml deliberately. Do not add raw HTML support, AI SDK, motion, Tailwind, or shadcn-generated components.

### 5. Validate the new behavior

Extend existing frontend SSE tests for abort cleanup, terminal handling, and malformed streams. Add focused API/controller regression tests for history restoration, request/session isolation, completion, cancellation/reset failure and races, and stale responses.

Add DOM/browser interaction tests using minimal appropriate development tooling if the existing Node-only harness cannot exercise focus, keyboard, and scroll behavior. Cover Enter/Shift+Enter/IME, disabled and unavailable actions, trace expansion, user anchors, manual-scroll preservation, latest navigation, and reduced motion.

Run `pnpm run test:frontend`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build`. Inspect the integrated UI at desktop/mobile widths and with keyboard navigation. Mock API responses; do not run paid provider tests.

## Completion criteria

The home route renders a working, component-composed chat based on the reference. Real durable history, typed stage progress, send, cancellation, reset, safe Markdown/code rendering, anchored scrolling, and accessible states work. Every unsupported capability is visible and clearly marked unavailable. No backend behavior or unrelated scaffold pages are changed.
