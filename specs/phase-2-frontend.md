# Phase 2 Spec — React Chat UI + Backend Wiring

> **Scope:** Part 2 of `ASSIGNMENT.md` — the React frontend that consumes the Phase 1 SSE wire format. **Voice (Part 3) is deferred to Phase 3** but the design source includes static voice components, so this spec records which Composer / AudioPlayer states ship inert in Phase 2 vs become live in Phase 3. **Docker / CI is Phase 4.**

> **Backend reference:** `specs/archive/phase-1-agentic-streaming-backend.md` (closed at commit `62f81f3`). All endpoint and SSE contracts cited below come from there. Do not modify backend without updating this spec first.

> **Design source:** `design/` — Claude Design handoff bundle. Key files: `design/project/screens.jsx`, `design/project/components.jsx`, `design/project/tokens.css`, `design/project/components.css`. Read `design/README.md` first; `design/chats/chat1.md` carries the design intent.

---

## 1. Verification — design ↔ backend feasibility

The design specifies 8 screens (S-1 through S-8) plus components and tokens pages. **Every UI affordance the design renders maps to a Phase 1 SSE event or HTTP endpoint that already ships.** No backend extension required.

### 1.1 Component → wire event mapping

| Design component (file) | Phase 1 wire / HTTP source | Note |
| --- | --- | --- |
| `FirstTokenIndicator` (components.jsx) | server-emitted `start` event (§3.2.1) | First frame after POST `/api/chat`; UI shows pre-token shimmer. |
| `ReasoningPanel state="streaming-expanded"` | `reasoning-start` + N×`reasoning-delta` (concat to body) | `text` deltas come on `delta` field |
| `ReasoningPanel state="settled-collapsed"` | `reasoning-end` event collapses panel | Header reads "Thoughts" once settled |
| `ToolCall state="pending"` | `tool-call-start` + `tool-call-delta` (partialInput streaming) | Show `{ id, name }`; collapsed pill |
| `ToolCall state="running"` | `tool-call-end` event | Args parsed; spinner ring active |
| `ToolCall state="complete-success"` | `tool-call-result` with `isError: false` | Green check; expandable to show input + output |
| `ToolCall state="complete-error"` | `tool-call-result` with `isError: true` | Warn badge; output rendered as error |
| Main answer text (`AnswerBody` + `Caret`) | N×`text-delta` (concat to message body) | Markdown rendered; trailing `Caret` while phase ∈ `{streaming}` |
| `MessageFooter` (`tokensIn`, `cached`, `tokensOut`, `cost`) | terminal `metadata` event | Maps `inputTokens`, `cacheReadTokens`, `outputTokens`, `costUsd`, `model` 1:1 |
| `CappedNotice` | `step { reason: 'capped' }` event | Followed by terminal `metadata` (no `error`) |
| `ErrorPill` | `error` event | Carries `{ code, message }`; one of `UPSTREAM_TIMEOUT`, `UPSTREAM_TRUNCATED`, `CONTENT_FILTERED`, `UPSTREAM_ERROR`, `INTERNAL` |
| `LoadingSkeleton` | client-side state while hydrating `GET /api/conversations/:id` | Pre-render skeleton until conversation rows arrive |
| `Sidebar` (conversation list, active highlight) | `GET /api/conversations` (list) → `GET /api/conversations/:id` (detail) | List excludes `messages` for size; full conversation lazy-loaded on selection |
| `Sidebar empty` state | `GET /api/conversations` returns `[]` | First-run; CTA opens fresh chat |
| `MessageFooter showMenu` (Copy / Delete) | client-side copy + `DELETE /api/messages/:id` | Backend accepts only user-message ids; cascades through the turn |
| `PromptSuggestions` | client-side static (no backend) | Pre-canned queries: "What does ibuprofen do?", "Symptoms of dehydration?", etc. |

### 1.2 Phase 3 components present in the design but inert in Phase 2

| Design component | Phase 3 backing | Phase 2 behavior |
| --- | --- | --- |
| `Composer state="recording"` | Browser Web Speech API (Phase 3 part 1) | Render mic button in default `idle` state; pressing toasts "voice input available in Phase 3" |
| `Composer state="denied"` (S-5 screen) | Mic permission flow (Phase 3) | Static screen only; no live permission probe in Phase 2 |
| `Composer ttsOn` toggle | Phase 3 TTS (`/api/tts` endpoint) | Toggle present, persists in local state, no-op functionally |
| `AudioPlayer` (S-3 + TTS variant) | Phase 3 TTS audio playback | Render only as a static showcase in Storybook / component gallery; not surfaced in chat flow |

### 1.3 Screens × wire-state mapping

| Screen | Phase 1 state it represents | Active wire events |
| --- | --- | --- |
| **S-1 Empty / first-run** | No active conversation. `GET /api/conversations` empty. | none — pre-stream |
| **S-2 Mid-stream snapshot** | Mid-`POST /api/chat` after `start`, during reasoning + first tool call | `start, reasoning-start, reasoning-delta…, reasoning-end, tool-call-start, tool-call-delta…, text-delta…` |
| **S-2 Live (replayable)** | Same as S-2; replay is design-internal demo | (same — synthesized from a fixture inside the React UI for the recording demo) |
| **S-3 Settled** | Stream finished cleanly | terminated by `metadata` event |
| **S-3 + TTS** | Same as S-3 with `<AudioPlayer>` mounted | Phase 3 wires `/api/tts` |
| **S-4 Sidebar focus** | Conversation list visible / mobile sheet | `GET /api/conversations` |
| **S-5 Mic permission denied** | Composer banner with `<Lock>` icon | Static in Phase 2 |
| **S-6 Mid-stream error** | `error` event arrived after partial text | `start, …, error` (no `metadata`) |
| **S-7 Step cap reached** | `step{capped}` arrived after multiple tools | `…, step{capped}, metadata` |
| **S-8 Loading skeleton** | Hydrating from `GET /api/conversations/:id` | Pre-render until JSON resolves |

### 1.4 Backend gaps surfaced by verification

**None.** The Phase 1 backend exposes every event the design renders. Specifically:
- `metadata.cacheReadTokens` is present (Step 0.6 §3) — design's `MessageFooter cached` field maps cleanly.
- `step.reason: 'capped'` is wired (Slice 6 `TranslateCtx.maxSteps`) — `CappedNotice` consumes it.
- `tool-call-result.isError` is derived at translate time — `ToolCall state="complete-error"` consumes it.
- `error.code` taxonomy includes `UPSTREAM_TIMEOUT, UPSTREAM_TRUNCATED, CONTENT_FILTERED, UPSTREAM_ERROR, INTERNAL` — `ErrorPill` can render any of them.
- Per-message delete (`DELETE /api/messages/:id`) restricted to user-message ids; `MessageFooter` Delete action targets the user message of the displayed turn (not the assistant row).
- `X-Request-Id` echoed by backend → UI captures it for support correlation.

---

## 2. Tooling stack (recommended, library choices subject to `AskUserQuestion` at slice-1 time)

| Concern | Pick | Why |
| --- | --- | --- |
| Build / dev server | **Vite + React 18 + TypeScript** | Bun-friendly, fast HMR, well-trodden |
| Test runner | **Vitest** + `@testing-library/react` | Vite-native; jsdom for component tests |
| API mocking in tests | **MSW** | Mock SSE responses in jsdom without spinning up a server |
| Markdown rendering | **react-markdown + remark-gfm + rehype-highlight** | GFM tables, code highlighting, plugin ecosystem |
| Styling | **CSS Modules + design/tokens.css** | Mirror the design source as-is; no Tailwind / styled-components |
| State | **Zustand** (or React context for Phase 2 scope) | Small, no boilerplate, fits a single-user chat app |
| HTTP / SSE | Native `fetch` + `ReadableStream.getReader()` | `EventSource` doesn't support POST |
| Routing | **React Router v6** | Phase 2 routes: `/`, `/c/:id` |
| Linting | **ESLint + @typescript-eslint** | Match Phase 1's strictness |
| Bun-native dev | `bun run dev` proxies `/api` → `:8787` via Vite config | Single dev workflow per workspace |

Final picks gated on user input at the start of slice 1.

---

## 3. Architecture

### 3.1 Repo layout (new `frontend/` workspace next to existing `backend/`)

```
rx-assitant/
├── backend/                      # Phase 1 (closed)
└── frontend/                     # Phase 2 (new)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts            # /api proxy → :8787; SSE-friendly server
    ├── index.html
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx               # Router + global providers
    │   ├── styles/
    │   │   ├── tokens.css        # ported verbatim from design/project/tokens.css
    │   │   ├── components.css    # ported verbatim from design/project/components.css
    │   │   └── reset.css
    │   ├── lib/
    │   │   ├── wire.ts           # SSE event types mirroring backend §3.2.1
    │   │   ├── api.ts            # fetch wrappers for /api/conversations, /api/messages
    │   │   ├── sse-parse.ts      # ReadableStream → AsyncIterable<SSEFrame>
    │   │   └── markdown.tsx      # react-markdown wrapper + custom renderers
    │   ├── hooks/
    │   │   ├── useChatStream.ts          # state machine: idle → submitting → streaming → done | error
    │   │   ├── useConversations.ts       # list + select + invalidate
    │   │   └── useTheme.ts               # light/dark toggle, persists to localStorage
    │   ├── store/
    │   │   └── chat.ts           # Zustand store: conversations, activeId, draft, ttsOn
    │   ├── components/           # one file per design component
    │   │   ├── Caret.tsx
    │   │   ├── FirstTokenIndicator.tsx
    │   │   ├── ReasoningPanel.tsx
    │   │   ├── ToolCall.tsx
    │   │   ├── MessageFooter.tsx
    │   │   ├── CappedNotice.tsx
    │   │   ├── ErrorPill.tsx
    │   │   ├── Composer.tsx
    │   │   ├── AudioPlayer.tsx          # Phase 3 — render in inert form
    │   │   ├── LoadingSkeleton.tsx
    │   │   ├── Sidebar.tsx
    │   │   ├── PromptSuggestions.tsx
    │   │   ├── UserMessage.tsx
    │   │   ├── AssistantMessage.tsx     # composes ReasoningPanel + ToolCall list + AnswerBody + MessageFooter
    │   │   └── ThemeToggle.tsx
    │   ├── pages/
    │   │   ├── ChatPage.tsx              # `/c/:id` and `/`
    │   │   └── NotFound.tsx
    │   └── types/
    │       └── api.ts            # mirrors backend response shapes
    └── tests/
        ├── _helpers/
        │   ├── mockSseStream.ts
        │   ├── renderWithProviders.tsx
        │   └── fixtures.ts
        ├── lib/sse-parse.test.ts
        ├── hooks/useChatStream.test.ts
        ├── components/{Composer,ReasoningPanel,ToolCall,...}.test.tsx
        └── pages/ChatPage.test.tsx
```

### 3.2 SSE consumer hook — state machine

`useChatStream({ conversationId?, message })` returns:

```ts
type ChatStreamState =
  | { phase: 'idle' }
  | { phase: 'submitting' }      // POST sent, awaiting first frame (renders FirstTokenIndicator)
  | { phase: 'streaming'; assistant: AssistantMessageInProgress }
  | { phase: 'done'; assistant: PersistedAssistantMessage }
  | { phase: 'error'; code: ErrorCode; message: string }
```

`AssistantMessageInProgress` accumulates:

```ts
type AssistantMessageInProgress = {
  messageId: string                   // from start.messageId
  userMessageId: string               // from start.userMessageId
  conversationId: string              // from start.conversationId
  model: string
  reasoning: { open: boolean; text: string; done: boolean }
  toolCalls: Array<{
    id: string                         // tool-call-start.id
    name: string
    state: 'pending' | 'running' | 'complete-success' | 'complete-error'
    partialInput: string                // accumulating from tool-call-delta
    input?: unknown                     // from tool-call-end
    output?: unknown                    // from tool-call-result
    durationMs?: number
  }>
  text: string                        // accumulating from text-delta
  steps: Array<{ index: number; reason: 'tool' | 'final' | 'capped' }>
  metadata?: MetadataPayload          // arrives once on terminal frame
}
```

Reducer transitions are 1:1 with §3.2.1 events:

| Event | Reducer effect |
| --- | --- |
| `start` | `phase = 'streaming'`; init `assistant` with ids + model |
| `reasoning-start` | `reasoning.open = true` |
| `reasoning-delta` | `reasoning.text += delta` |
| `reasoning-end` | `reasoning.done = true` (panel collapses to "Thoughts") |
| `tool-call-start` | push new toolCall `{state: 'pending'}` |
| `tool-call-delta` | append to `partialInput` of matching id |
| `tool-call-end` | set `input`, transition to `running` |
| `tool-call-result` | set `output` + `durationMs`, transition to `complete-success` or `complete-error` based on `isError` |
| `step` | push step record (used for capped notice rendering) |
| `text-delta` | `text += delta` |
| `metadata` | record metadata; transition to `phase = 'done'` (clean up reasoning open state, show MessageFooter) |
| `error` | transition to `phase = 'error'` with `{ code, message }` |
| (stream close without metadata) | leave at `phase = 'streaming'` if no `error` arrived (defensive) |

### 3.3 Wiring layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  ChatPage                                                            │
│   │                                                                  │
│   ├─▶ Sidebar  ←── useConversations() ─── GET /api/conversations     │
│   │     │                                                            │
│   │     └─▶ select id → react-router → /c/:id                       │
│   │                                                                  │
│   ├─▶ MessageList                                                   │
│   │     ├─▶ UserMessage (history rows where role='user')             │
│   │     └─▶ AssistantMessage                                         │
│   │           ├─▶ ReasoningPanel                                     │
│   │           ├─▶ ToolCall × N  (combines tool-call assistant rows + │
│   │           │                  tool tool-result rows by id)        │
│   │           ├─▶ AnswerBody (markdown)                              │
│   │           ├─▶ CappedNotice (if last step.reason === 'capped')    │
│   │           ├─▶ ErrorPill (if phase === 'error')                   │
│   │           └─▶ MessageFooter (when metadata available)            │
│   │                                                                  │
│   └─▶ Composer ── onSubmit ──┐                                       │
│                              │                                       │
│        useChatStream() ◀─────┘                                       │
│           │                                                          │
│           ├─▶ POST /api/chat (fetch + ReadableStream)                │
│           ├─▶ sse-parse → frames → reducer → store                   │
│           └─▶ on done: useConversations.invalidate(activeId)         │
└──────────────────────────────────────────────────────────────────────┘
```

`useConversations.invalidate` re-fetches the conversation detail so the persisted history (including the just-completed turn) replaces the in-flight `useChatStream` state. After invalidate the message renders from the same source as historical messages — no special-case rendering for "just-streamed" vs "loaded".

### 3.4 Loading conversation history (FR-7 / FR-8 round-trip)

Stored shape (Phase 1 §2.4) is per-row `ContentPart[]`. Multi-step turns produce up to 4 rows: `user`, `assistant` (tool-call), `tool` (tool-result), `assistant` (final text). The frontend regroups these into a single rendered "assistant turn" before display:

```ts
function groupIntoTurns(messages: Message[]): Turn[] {
  // Split on user-message boundaries; everything between two user messages
  // (assistant + tool rows) collapses into one AssistantMessage.
  // Within an assistant turn, pair tool-call parts with tool-result parts by toolCallId.
}
```

This grouping lives in `frontend/src/lib/turns.ts`; it has direct unit-test coverage. The Phase 1 wire-time `useChatStream` reducer produces the same shape, so live-streaming and historical rendering share the `<AssistantMessage>` component.

### 3.5 Routing

| Path | Page | Behavior |
| --- | --- | --- |
| `/` | ChatPage with no active conversation | First-run S-1 empty state |
| `/c/:id` | ChatPage with active conversation | Hydrate via `GET /api/conversations/:id`, then mount `MessageList` |
| (any other) | NotFound | Light 404 page; "back to chats" CTA |

POST `/api/chat` with `conversationId` undefined creates a new conversation server-side; on `start`'s `conversationId`, the React router redirects from `/` to `/c/:newId` so the URL is shareable.

---

## 4. Slice plan (TDD-driven, per the project pause-for-review discipline)

Slice numbering continues from Phase 1. Each slice ends with **green tests + commit + pause for user review**.

### Slice 9 — Frontend bootstrap + design tokens import + theme toggle

**Tests first** — Vitest setup; smoke test renders App without throwing.
**Impl** — `frontend/package.json`, `vite.config.ts` (with `/api` proxy → `:8787`), `tsconfig.json`, `src/main.tsx`, `src/App.tsx`, `src/styles/{tokens,components,reset}.css` (ported verbatim from `design/project/`), `src/components/ThemeToggle.tsx` + persistence, `src/hooks/useTheme.ts`.
**DoD** — `cd frontend && bun run dev` opens the empty layout with paper background; light/dark toggle works.

### Slice 10 — Wire types + SSE parser (pure logic, easiest to TDD)

**Tests first** — `tests/lib/sse-parse.test.ts` (parses `event:`/`data:` frames, handles multi-line, EOF without `\n\n`); `tests/lib/wire.test.ts` (every event type from §3.2.1 has a typed shape).
**Impl** — `src/lib/wire.ts` (event union type, `MetadataPayload`, `ErrorCode`, `ContentPart`), `src/lib/sse-parse.ts` (Generator-yielding parser).
**DoD** — Round-trip a recorded fixture (saved live OpenRouter stream) → 100% events parsed.

### Slice 11 — `useChatStream` hook (state machine)

**Tests first** — `tests/hooks/useChatStream.test.ts` against MSW-mocked SSE responses for each scenario from `archive/phase-1-slice-6-test-plan.md` I-1, I-1r, I-2, I-2e, I-3, I-6 (error event), I-8 (timeout), I-9 (mid-stream error). Reducer state transitions assertable per-frame.
**Impl** — `src/hooks/useChatStream.ts`, `src/lib/turns.ts` (grouping for historical replay).
**DoD** — All scenarios produce the expected `phase` + `assistant` shape; abort propagates to backend.

### Slice 12 — Static components from design (parallel-safe, no wiring yet)

**Tests first** — Snapshot + a11y tests per component (`@testing-library`).
**Impl** — `Caret`, `FirstTokenIndicator`, `UserMessage`, `ReasoningPanel`, `ToolCall`, `MessageFooter`, `CappedNotice`, `ErrorPill`, `LoadingSkeleton`, `PromptSuggestions`. Pixel-port from `design/project/components.jsx` keeping prop signatures; replace prototype's local state with controlled props.
**DoD** — Component gallery page (`/__components` route, dev-only) renders every state from S-1…S-8 without errors.

### Slice 13 — Sidebar + conversation list + routing

**Tests first** — `tests/hooks/useConversations.test.ts`; `<Sidebar>` selects + highlights active.
**Impl** — `src/lib/api.ts` (fetch wrappers), `src/hooks/useConversations.ts`, `src/components/Sidebar.tsx`, `src/pages/ChatPage.tsx` (route shell), router setup.
**DoD** — Conversation list loads from `GET /api/conversations`; clicking nav-route to `/c/:id`; active row highlighted.

### Slice 14 — Composer (text-only — voice deferred to Phase 3)

**Tests first** — `tests/components/Composer.test.tsx`: types into textarea; Enter submits; Shift+Enter inserts newline; mic button shows tooltip "voice input coming in Phase 3" but does not throw.
**Impl** — `src/components/Composer.tsx`, integrate with `useChatStream`. TTS toggle persists to local state but is not wired.
**DoD** — User can type + send; submitting state shows spinner; FirstTokenIndicator appears between submit and first frame.

### Slice 15 — Live `AssistantMessage` rendering against `useChatStream`

**Tests first** — Component+integration tests for happy path, tool-roundtrip, capped, error. Use the MSW-mocked stream from Slice 11.
**Impl** — `src/components/AssistantMessage.tsx`, markdown rendering, `MessageList` composer, history-vs-live unified rendering via `turns.ts`.
**DoD** — Live stream produces correct visual sequence (matches design's S-2 Live behavior). Errors surface ErrorPill. Capped surfaces CappedNotice + metadata.

### Slice 16 — History hydration + delete

**Tests first** — `tests/pages/ChatPage.test.tsx` loads `GET /api/conversations/:id` on mount; LoadingSkeleton until resolved; turns rendered correctly. Delete user message → optimistic UI update + `DELETE /api/messages/:id` + invalidate.
**Impl** — Hydration code in `ChatPage`, MessageFooter "Delete" action. Confirms before deleting (whole-turn cascade is destructive).
**DoD** — Reload page → history renders identically to post-stream view (both go through the same `<AssistantMessage>` via `turns.ts`).

### Slice 17 — Polish: dark-mode parity, mobile breakpoint, prefers-reduced-motion

**Tests first** — Visual regression smoke tests (Vitest + @testing-library/jest-dom for class checks). Tab-trap on Composer.
**Impl** — Mobile breakpoint per `design/project/components.css` (S-4 sidebar → sheet, message bubbles 86%). Reduced-motion fallbacks (Caret static, ToolCall pill no spin).
**DoD** — Mobile (390×844) renders correctly; light/dark globally toggles; lighthouse a11y > 90.

### Slice 18 — Phase 2 closure: live demo, recording prep

**Tests first** — None; manual end-to-end.
**Impl** — README updates, Storybook (optional) for component gallery, demo script.
**DoD** — `bun run dev` (backend) + `bun run dev` (frontend), real OpenRouter key, full healthcare prompt → recording-ready demo. All Phase 2 acceptance items in §6 below tick green.

---

## 5. Frontend testing strategy

- **Unit (Vitest, jsdom)** — pure functions in `lib/`, hooks in isolation via `@testing-library/react-hooks` (or `renderHook` from RTL v15+).
- **Component (Vitest + RTL)** — every design component gets snapshot + a11y + key state tests. Fixtures live in `tests/_helpers/fixtures.ts`.
- **Integration (Vitest + MSW)** — mocks Phase 1 endpoints (chat SSE, conversations CRUD, usage). Uses recorded SSE fixtures derived from live OpenRouter calls.
- **E2E** — manual via the live recording session, plus a thin Playwright smoke for the happy-path journey if time permits (defer if not).
- **Visual** — Storybook deferred. Component gallery page (Slice 12) serves the same purpose for the recording.

---

## 6. Phase 2 acceptance (verifiable)

End of Phase 2 ships when **all** of these are true:

1. `cd frontend && bun test` — all green.
2. `cd frontend && bun run typecheck` — clean.
3. With the backend running (`cd backend && bun run dev`), `bun run dev` in `frontend/` opens a chat UI at `http://localhost:5173` (or Vite default).
4. Sending the canonical healthcare prompt streams text token-by-token, renders reasoning panel during streaming and collapses on settle, shows tool-call pills with state transitions, and renders the final answer in markdown with the message footer carrying live token + cost numbers.
5. Reload after a turn completes → identical render via the history-load path (proves §3.4 grouping works).
6. Delete the user message of a turn → entire turn disappears + position renumbers (verified by another reload).
7. Mid-stream error scenario (force backend `OPENROUTER_API_KEY` invalid) renders `<ErrorPill>` correctly without crashing.
8. Light/dark toggle works globally; mobile (Chrome devtools 390 width) renders all eight screens correctly per `design/project/screens.jsx`.
9. Voice components present-but-inert (mic button shows "Phase 3" tooltip, AudioPlayer not rendered in main flow). No surprises when Phase 3 wires them.
10. Recording-ready: a continuous narrated session can demo the full journey without fighting the UI.

---

## 7. Failure modes (UI-side)

| ID | Trigger | Symptom | Mitigation | Spec id reference |
| --- | --- | --- | --- | --- |
| UI-F-1 | Backend down (connection refused on POST `/api/chat`) | Spinning composer | Toast "Couldn't reach the server"; `phase = 'error'` with synthesized `{ code: 'NETWORK_ERROR' }` | new |
| UI-F-2 | Backend returns 4xx JSON envelope (e.g. INVALID_INPUT) | No SSE opens | Read response as JSON, render `<ErrorPill>` with `code` + `message` | mirrors backend §3.4 |
| UI-F-3 | Stream closes mid-flight without `metadata` or `error` | Indeterminate loading | Defensive timeout (e.g. `AI_TIMEOUT_MS + 5s`) → render `<ErrorPill>` `{code: 'STREAM_TRUNCATED'}` | new — covers F-7 / F-11 from frontend perspective |
| UI-F-4 | Markdown parser throws on malformed assistant text | Component crash | Error boundary around `<AssistantMessage>`; falls back to plain text | new |
| UI-F-5 | History grouping sees orphan tool-result with no matching tool-call | Display anomaly | Skip orphan + log to console; backend already prevents this (NFR-8) | mirrors NFR-8 |
| UI-F-6 | DELETE returns 400 INVALID_TARGET | User clicks delete on assistant row (shouldn't happen — UI guards) | Toast + retain row; bug-report instrumentation | mirrors backend §3.3 |
| UI-F-7 | Conversation list refresh loop (e.g. WebSocket-style polling) | UX jitter | Phase 2 has **no live conversation-list updates**; refresh only after `done`/`error` of an active turn | scope decision |

---

## 8. Out of scope (Phase 2)

- **Voice input / output** — Phase 3. `Composer mic`, `Composer state="recording"`, `<AudioPlayer>` are inert in Phase 2.
- **Optimistic message append** during stream — already implicit in `useChatStream`; explicit optimistic-UI updates for delete are limited to local state changes between request and response.
- **Streaming retry** — out of scope; on stream error, user resends manually.
- **Real-time collaboration / multi-tab sync** — single-user assumption holds.
- **Message edit** — only delete + re-prompt. `MessageFooter` shows Copy + Delete only.
- **Search across conversations** — not in design; defer.
- **Storybook** — defer to Phase 4 if at all.

---

## 9. Sign-off

| Axis | Decision |
| --- | --- |
| Bundler / dev | Vite + React 18 + TypeScript |
| Test runner | Vitest + Testing Library + MSW |
| State | Zustand (or context for the smaller pieces) |
| SSE | hand-parsed `fetch` + ReadableStream |
| Styling | CSS Modules + ported `tokens.css` / `components.css` |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| Routing | React Router v6 |
| Voice scope | Phase 3 (deferred — design components ship inert) |
| Design source | `design/` bundle from Claude Design — port verbatim then refactor |
| Backend dependence | No backend changes required; Phase 1 spec is the contract |
