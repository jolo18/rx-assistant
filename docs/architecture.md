# rx-assistant — design decisions, schema & system reference

A single-source synthesis of what was built across all four phases. Decisions, the persisted data model, the SSE wire format, the frontend state machines, the trade-offs we accepted on purpose, and the failure modes we mapped. Drill into any section's full original context via §10.

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Data model & wire format](#3-data-model--wire-format)
4. [State machines](#4-state-machines)
5. [Decisions log](#5-decisions-log)
6. [Trade-offs explicitly accepted](#6-trade-offs-explicitly-accepted)
7. [Failure modes (consolidated)](#7-failure-modes-consolidated)
8. [Out of scope](#8-out-of-scope)
9. [Acceptance items per phase](#9-acceptance-items-per-phase)
10. [References](#10-references)

---

## 1. Project overview

**rx-assistant** is a single-user healthcare-information chat: stream a reasoned answer, optionally call tools (`drug_info`, `symptom_lookup`) mid-stream, render the agent's thinking and tool activity legibly, and let the user listen to settled answers via the OS TTS engine.

| Phase | Closed at | Tests | Headline |
| --- | --- | --- | --- |
| 1 — Backend | `62f81f3` | 170 / 170 | Bun + Hono SSE, OpenRouter agent loop with two healthcare tools, Drizzle/SQLite persistence, layered pino logging |
| 2 — Frontend | `2a680b2` | 175 / 175 | Vite + React 19 + react-router-dom v7, MSW-mocked SSE integration tests, design ported verbatim from the handoff bundle |
| 3 — Voice | `3badd52` | 220 / 220 | Web Speech API for STT (5 s manual silence timer), Web Speech Synthesis for TTS (chunked at ≤500 chars). **Backend untouched.** |
| 4 — DevOps | `e640c5a` | 170 + 220 | Multi-stage `oven/bun:1-slim` Dockerfiles, healthy-dependency-gated `docker compose`, automated migration on entrypoint, GitHub Actions CI |

Slice numbering ran 1 → 25 across the four phases. Each slice was a vertical-slice TDD step: tests-first, pause for review, conventional commit. The arc is searchable via `git log --oneline --grep="slice"`.

---

## 2. Architecture

### 2.1 Backend stack

- **Bun 1.x** + TypeScript runtime — no transpile step.
- **Hono** for HTTP, with `hono/streaming` `streamSSE` for the chat endpoint.
- **Vercel AI SDK** (`ai`) + **`@openrouter/ai-sdk-provider`** drives the agent loop. `streamText({ tools, stopWhen: stepCountIs(MAX_AGENT_STEPS) })` is the central call.
- **SQLite** via `bun:sqlite` + **Drizzle ORM** + `drizzle-kit` migrations. WAL mode enabled at startup for read concurrency.
- **Zod** for input validation, **ULID** for IDs, **pino** for structured layered logging (`http | service | repo | tool | boot`, all sharing a `requestId`; the response carries `X-Request-Id` so the client can correlate).

### 2.2 Frontend stack

- **Vite + React 19 + TypeScript** + **react-router-dom v7**.
- **Vitest 4** + **@testing-library/react** + **MSW v2** — MSW mocks `/api/chat` SSE responses end-to-end.
- **react-markdown** + `remark-gfm` + `rehype-highlight` for the answer body.
- State is local: `useReducer` for `useChatStream`, `useState` per-component for transient UI, `localStorage` for theme + TTS preference. No Zustand, no Redux.
- Design tokens (`tokens.css`) and `components.css` ported verbatim from `design/project/`.
- **Custom SSE consumer** — EventSource doesn't support `POST`, so we hand-parse `fetch().body.getReader()` + `TextDecoder`.

### 2.3 Voice stack (browser-native, no infra)

- **STT** via `window.SpeechRecognition` / `webkitSpeechRecognition`. `useSpeechRecognition` runs `continuous = true` with a manual 5 s silence timer that resets on every `result` event. Iterates from `event.resultIndex` (Chrome's canonical pattern) so cumulative results don't double-count finals.
- **TTS** via `window.speechSynthesis` + `SpeechSynthesisUtterance`. `useTts` chunks long text (≤500 chars per utterance) and queues chunks via `onend → speak(next)` to dodge Chrome's ~15 s utterance cap. Single global "now-speaking" — calling `play()` cancels the prior utterance.
- **Provider-neutral facade** at `frontend/src/lib/tts.ts` — if a future phase swaps to a server-side TTS, that's the only file the hook touches.

### 2.4 DevOps stack

- **`oven/bun:1-slim`** for both images (Bun's own production guidance). Multi-stage builds; final backend image ~369 MB, frontend ~93 MB.
- **`docker-compose.yml`** at the repo root. Backend healthcheck (HEALTHCHECK in Dockerfile) gates the frontend service via `depends_on: { backend: { condition: service_healthy } }` — the assignment's "services should only start once their dependencies are healthy" rule, demonstrably enforced.
- **Automated migration** — `backend/docker-entrypoint.sh` runs `bun run migrate` then `exec`s the server, so `/api/chat` always hits a schema-current DB.
- **GitHub Actions CI** — two jobs: a `test` matrix (`backend | frontend`, fail-fast) and a `compose` smoke job that builds the stack, polls `/health`, curls the nginx-proxied `/api/conversations`, then tears down with `--volumes`.

### Request flow (compose runtime)

```
                       ┌────────────────────────────────────────────────────────────┐
                       │ frontend (nginx + dist/)                                   │
                       │   :80 in container → host :5173                            │
                       │   /api/* → http://backend:8787 (proxy_buffering off)       │
                       └─────────────────────────────┬──────────────────────────────┘
                                                     │  fetch + ReadableStream + SSE
                                                     ▼
                       ┌────────────────────────────────────────────────────────────┐
                       │ backend (Bun + Hono + AI SDK + sqlite)                     │
                       │   :8787, runs migrations on entrypoint, then /api/* + /health │
                       │   POST /api/chat → Vercel AI SDK fullStream → SSE          │
                       └─────────────────────────────┬──────────────────────────────┘
                                                     │
                                                     ▼
                                          ┌─────────────────────────┐
                                          │ named volume `sqlite-data`
                                          │   /data/app.db          │
                                          └─────────────────────────┘
```

OpenRouter is external; the backend reaches it directly. Voice surfaces (STT + TTS) bypass the network entirely — they're browser ↔ OS only.

---

## 3. Data model & wire format

### 3.1 SQLite schema

Three tables, one JSON-blob column. Drizzle source: `backend/src/db/schema.ts`.

```ts
conversations   id PK · title TEXT? · created_at INT · updated_at INT
messages        id PK · conversation_id FK→conversations(cascade) · role ENUM('user','assistant','tool')
                content JSON (ContentPart[] | string) · position INT · created_at INT
                UNIQUE(conversation_id, position)
                INDEX (conversation_id, created_at)
                CHECK role IN ('user','assistant','tool')
usage           id PK · message_id FK→messages(cascade, UNIQUE) · model TEXT
                input_tokens INT · output_tokens INT · cache_read_tokens INT · cache_create_tokens INT
                latency_ms INT · cost_usd REAL · created_at INT
```

Why JSON-blob `messages.content`: round-trip into `streamText({ messages })` is lossless and trivial; one read = one row per message; ordering inside a message is preserved by array index. The cost — losing SQL queries against part contents — is negligible because we never query *into* a single message's parts.

### 3.2 ContentPart discriminated union

Stored shape per `messages.content` entry. Verbatim from `backend/src/db/schema.ts` and mirrored in `frontend/src/lib/chat-events.ts`:

```ts
type ContentPart =
  | { type: 'text';        text: string }
  | { type: 'reasoning';   text: string }
  | { type: 'tool-call';   toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: ToolResultOutput }
```

A multi-step turn typically produces 4 rows: `user` → `assistant` (one tool-call part) → `tool` (one tool-result part) → `assistant` (final text). Frontend regroups via `frontend/src/lib/turns.ts` so historical and live rendering share the same `<AssistantMessage>` component.

### 3.3 ToolResultOutput shape

Five variants, mapping AI SDK ToolResultOutput:

```ts
type ToolResultOutput =
  | { type: 'json';        value: unknown }
  | { type: 'text';        value: string }
  | { type: 'error-text';  value: string }
  | { type: 'error-json';  value: unknown }
  | { type: 'content';     value: Array<
      | { type: 'text';  text: string }
      | { type: 'media'; data: string; mediaType: string }
    > }
```

`isError` is **derived** at translate time as `output.type.startsWith('error-')` — not stored on the part itself. The wire format keeps an `isError` boolean for UI convenience.

### 3.4 SSE event taxonomy

`POST /api/chat` returns `text/event-stream`. Twelve event names, each with a typed JSON `data` payload. Frontend mirror lives in `frontend/src/lib/chat-events.ts` (`ChatEvent` discriminated union).

| `event:` | `data:` payload | Sourced from AI SDK part |
| --- | --- | --- |
| `start` | `{ messageId, userMessageId, conversationId, model }` | server-emitted after persisting the user message |
| `text-delta` | `{ delta: string }` | `text-delta` |
| `reasoning-start` | `{}` | `reasoning-start` |
| `reasoning-delta` | `{ delta: string }` | `reasoning-delta` |
| `reasoning-end` | `{}` | `reasoning-end` |
| `tool-call-start` | `{ id, name }` | `tool-input-start` |
| `tool-call-delta` | `{ id, partialInput }` | `tool-input-delta` |
| `tool-call-end` | `{ id, input }` | `tool-call` |
| `tool-call-result` | `{ id, output, isError, durationMs }` | `tool-result` |
| `step` | `{ index, reason: 'tool' \| 'final' \| 'capped' }` | `step-finish` (happy path) |
| `metadata` | `{ messageId, model, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, latencyMs, costUsd }` | `finish` (final) — **terminal happy-path event**; client treats stream-close-after-`metadata` as "done" |
| `error` | `{ code, message }` | `error` part OR caught exception — terminal |

There is **no `done` event**. `metadata` followed by stream close is the terminal happy-path signal.

### 3.5 finishReason → wire-event mapping

```
stop                   →  step { reason: 'final' }     (model produced a final answer)
tool-calls             →  step { reason: 'tool' }      (model requested tools; loop continues)
(server-side cap hit)  →  step { reason: 'capped' }    (stopWhen: stepCountIs(N) triggered)
length                 →  error { code: 'UPSTREAM_TRUNCATED' }
content-filter         →  error { code: 'CONTENT_FILTERED' }
error                  →  error { code: 'UPSTREAM_ERROR' }
other / unknown        →  error { code: 'UPSTREAM_ERROR' }
```

### 3.6 Frontend mirror

`frontend/src/lib/chat-events.ts` exports the full `ChatEvent` union, `ErrorCode` literal type, `ContentPart`, `ToolResultOutput`, and `parseChatEvent(frame)` which validates and narrows. **`KNOWN_ERROR_CODES`** registers ten backend codes plus one UI-synthetic — `NETWORK_ERROR`, emitted by `useChatStream` when the client connection itself fails before/after receiving any frames.

```ts
KNOWN_ERROR_CODES =
  ['INVALID_INPUT', 'INVALID_TARGET', 'NOT_FOUND',
   'UPSTREAM_TIMEOUT', 'UPSTREAM_TRUNCATED', 'CONTENT_FILTERED',
   'UPSTREAM_ERROR', 'UNKNOWN_MODEL', 'INTERNAL', 'RATE_LIMITED',
   'NETWORK_ERROR' /* UI-synthetic */]
```

Forward-compat: unknown server-side codes flow through as `string` rather than crash the parser.

---

## 4. State machines

### 4.1 `useChatStream` — the live chat reducer

```ts
type ChatStreamState =
  | { phase: 'idle' }
  | { phase: 'submitting' }                              // POST sent, awaiting first frame
  | { phase: 'streaming'; assistant: AssistantMessageInProgress }
  | { phase: 'done';      assistant: AssistantMessageInProgress }
  | { phase: 'error'; code: ErrorCode; message: string }
```

`AssistantMessageInProgress` accumulates `messageId`, `userMessageId`, `conversationId`, `model`, `reasoning {open, text, done}`, `toolCalls[]` (each with state `pending|running|complete-success|complete-error`), `text`, `steps[]`, and `metadata?` (set on the terminal frame).

Reducer (1:1 with §3.4 events):

| Event | Reducer effect |
| --- | --- |
| `start` | `phase = 'streaming'`; init assistant with ids + model |
| `reasoning-start/delta/end` | mutate `reasoning` |
| `tool-call-start/delta/end/result` | push / append / transition slot state |
| `text-delta` | `text += delta` |
| `step` | push step record |
| `metadata` | record metadata; transition to `phase = 'done'` |
| `error` | transition to `phase = 'error'` with `{ code, message }` |
| (stream close without metadata) | leave at `phase = 'streaming'` (defensive) |

`<ChatStreamProvider>` lifts the hook above `<Routes>` so the mid-stream `/ → /c/:newId` route push (when `start.conversationId` arrives on a brand-new conversation) doesn't unmount the in-flight stream.

### 4.2 `useSpeechRecognition`

```ts
type State =
  | { phase: 'idle' }
  | { phase: 'unsupported' }                  // browser doesn't expose SpeechRecognition
  | { phase: 'denied' }                       // user blocked the mic
  | { phase: 'recording'; transcript: string }
  | { phase: 'error'; message: string }
```

`continuous = true; interimResults = true` plus a manual 5 s silence timer that resets on every `result` event. The Web Speech API's own `continuous = false` end-of-speech detector was too aggressive (~1–2 s), clipping normal speaking pauses.

### 4.3 `useTts`

```ts
type TtsState =
  | { status: 'idle' }
  | { status: 'unsupported' }
  | { status: 'speaking'; charIndex: number; totalChars: number }
  | { status: 'paused';   charIndex: number; totalChars: number }
  | { status: 'error'; code: ErrorCode; message: string }
```

`play(text)` cancels any prior utterance, splits the text into ≤500-char chunks (sentence-end first → whitespace fallback → hard cut), and queues chunks via each utterance's `onend`. `boundary` events advance `charIndex` cumulatively across chunks; `progress = charIndex / totalChars` drives the AudioPlayer's progress bar.

### 4.4 Backend agent loop

`POST /api/chat` opens an SSE stream. The route's `streamSSE` callback emits `start`, then iterates `result.fullStream` translating each AI SDK part into a typed wire event via `agent/translate.ts`, then emits `metadata` (or `error`) on finalization. The loop runs under `stopWhen: stepCountIs(env.MAX_AGENT_STEPS)`; the final `step` reason is one of `tool | final | capped`. Tool errors derive `isError` at translate time and the loop continues (the model gets the error result on the next round).

---

## 5. Decisions log

Every row maps to a Sign-off entry in one of the four archived specs.

### Phase 1 — Backend

| Axis | Pick | Why |
| --- | --- | --- |
| Runtime | Bun 1.x | Native SSE / fetch / ReadableStream / sqlite; no transpile step |
| HTTP framework | Hono | Minimal; first-class `streamSSE` helper |
| LLM SDK | Vercel AI SDK + OpenRouter | Provider-neutral via OpenAI-compatible gateway (`feedback_avoid_provider_lockin`) |
| Default model | `anthropic/claude-sonnet-4.6` | Swappable via `OPENROUTER_MODEL` env; registry in `backend/src/lib/pricing.ts` |
| Persistence | SQLite + Drizzle | Single-file DB; lossless content-parts blob; trivial dev / docker volume |
| Validation | Zod | Spec-first input parsing |
| IDs | ULID | Sortable, URL-safe, no DB autoincrement coupling |
| Logger | pino (structured layered) | One JSON line per request; `requestId` shared across `http \| service \| repo \| tool \| boot` |
| Wire format | SSE over POST | Browser `fetch` + `ReadableStream`; EventSource doesn't support POST |
| Storage shape | JSON content-parts blob per message row | Round-trip into `streamText({ messages })` is lossless (§3.2) |

### Phase 2 — Frontend

| Axis | Pick | Why |
| --- | --- | --- |
| Bundler / dev | Vite + React 19 + TypeScript | Fast dev, well-known, current React |
| Test runner | Vitest 4 + @testing-library/react + MSW v2 | MSW v2 mocks SSE streams cleanly |
| State | `useReducer` per hook + `useState` per component; localStorage for prefs | No Zustand / Redux — state didn't outgrow primitives |
| Markdown | react-markdown + remark-gfm + rehype-highlight | Spec recommendation |
| SSE consumer | Hand-parsed `fetch().body.getReader()` + `TextDecoder` | EventSource doesn't POST |
| Wire types | `frontend/src/lib/chat-events.ts` | Single source of truth mirroring §3.2.1 |
| Routing | react-router-dom v7 | `<ChatStreamProvider>` lifted above `<Routes>` so mid-stream push doesn't remount |
| Design source | Ports `tokens.css` + `components.css` verbatim | Pixel parity; no design rebuild |

### Phase 3 — Voice

| Axis | Pick | Why |
| --- | --- | --- |
| STT | Web Speech API (`SpeechRecognition`) | Browser-native; free; offline; symmetric with TTS |
| TTS | Web Speech Synthesis (`SpeechSynthesisUtterance`) | Browser-native; free; no API key, no GPU, no audio storage |
| Storage | None (in-memory state per message) | Web Speech Synthesis plays via OS audio stack; no Blob produced |
| Backend | Untouched | Phase 3 is purely frontend |
| Auto-play UX | `ttsOn` toggle in composer; persists in localStorage | Default off so a fresh user doesn't get surprise audio |
| Concurrency | Single global "now speaking" — new utterance cancels prior | Predictable; no audio overlap |
| AudioPlayer scrub | Read-only progress (no seek) | SpeechSynthesisUtterance doesn't expose duration; documented trade-off |
| Long-text | Chunk into ≤500-char segments queued via onend | Dodges Chrome's ~15 s utterance cap |

### Phase 4 — DevOps

| Axis | Pick | Why |
| --- | --- | --- |
| Image base | `oven/bun:1-slim` | Bun's prod guidance; ~120 MB Debian-slim |
| Containerize frontend | Yes | Lets `depends_on: service_healthy` apply; lets CI test the full stack |
| CI provider | GitHub Actions | Test matrix + compose smoke; fail-fast |
| Deployment | Local-only docker compose | Hosted out of scope; assignment asks for compose, not URL |
| Migration trigger | Entrypoint script (`bun run migrate && exec bun run start`) | Healthcheck is the gate dependent services / CI wait on |
| Volume | Named `sqlite-data:/data` | Survives `compose down`; cleared with `compose down -v` |
| Runtime user | Non-root uid 1001 (`rx`) | Container best practice; `/data` chowned at build |

---

## 6. Trade-offs explicitly accepted

Each entry: *we chose X* / *the cost is Y* / *we accepted Y because Z*.

### 6.1 L1 — `<CappedNotice>` is live-only on reload

We chose to **not persist `step.reason`** on the messages table. Cost: when a turn was cut off by the agent step cap, reloading the conversation drops the "Stopped after the maximum number of reasoning steps" banner. Accepted because: persisting step-level metadata would require either a new column or a new table for ephemeral execution telemetry, and the structural data (the tool calls and final text) survives.

### 6.2 L2 — `<ErrorPill>` is live-only on reload

We chose F-12: backend persists an empty assistant `content: []` row on terminal error rather than half-built content. Cost: reload shows the user message + an empty assistant slot, no error pill, no error code. Accepted because: F-12 is a strict integrity invariant (no orphan tool-use / partial state in the DB), and the reviewer-friendly explanation is "errors aren't recoverable from the UI's perspective in Phase 1 — re-prompt manually."

### 6.3 L3 — Tool durations live-only

We chose to **not persist `tool-call-result.durationMs`**. Cost: reload renders historical `<ToolCall>` pills with the badge text "Complete" instead of `0.7s`. Accepted because: the duration is a wire-only ornament; a reviewer reloading a settled conversation cares about *which tools fired with what input/output*, not how long each took.

### 6.4 No conversation rename

We chose to *not* implement `PATCH /api/conversations/:id`. Cost: the user can't rename a conversation; the title stays auto-derived from the first 60 chars of the first user message (Phase 1 §2.1). Accepted because: rename adds an entire endpoint + UI surface; auto-titles are correct >95% of the time and the assignment doesn't require it.

### 6.5 Voice quality is OS-dependent

We chose Web Speech Synthesis (browser-native) over a server-side TTS. Cost: macOS / iOS voices are excellent; Linux / Windows defaults are noticeably rougher. Accepted because: no API key, no GPU, no infra, no audio storage — the trade was reviewer experience for zero infrastructure overhead. Demo recorded on macOS for cleanest sound.

### 6.6 `<AudioPlayer>` scrub is read-only

We chose Web Speech Synthesis even though `SpeechSynthesisUtterance` doesn't expose a duration or seek. Cost: the full-variant scrub bar in the design's `<AudioPlayer>` is a read-only progress indicator (no thumb, no time labels) — progress is approximated via the `boundary` event's `charIndex / totalChars`. Accepted because: the alternative (a server route or a JS audio engine) would 10× the complexity for a feature most users won't use.

### 6.7 iOS Safari first-gesture rule

We chose to *not* work around iOS Safari's requirement that `speechSynthesis.speak()` only fires after a user gesture. Cost: on iOS Safari, auto-play on settle silently fails until the user has tapped *anything* on the page (clicking the TTS toggle counts). Accepted because: the workaround would mean popping a "click to enable audio" modal on first load, and the README documents the rule clearly.

### 6.8 Single-replica backend

We chose SQLite. Cost: backend is single-writer; can't horizontally scale beyond one instance. Accepted because: take-home scale is single-user; multi-replica HA would mean swapping in Postgres + a connection pool + a different migration story.

### 6.9 No TLS / reverse-proxy hardening in compose

We chose local-only compose with bare nginx. Cost: production deployments would need Caddy or Traefik in front for TLS, rate-limiting, IP allowlists. Accepted because: out of scope; the reviewer runs `docker compose up` on `localhost`.

### 6.10 No mid-stream resume after page reload

We chose to *not* make `POST /api/chat` idempotent. Cost: if the user reloads mid-stream, the backend keeps writing (or errors on disconnect via F-11), and the client comes up with the persisted user message + an empty assistant row; the user re-prompts manually. Accepted because: idempotent POST would require client-supplied request IDs + a deduplication store, and the frequency of mid-stream reloads in a single-user demo is ~zero.

---

## 7. Failure modes (consolidated)

### Backend (Phase 1)

| ID | Trigger | Symptom | Mitigation |
| --- | --- | --- | --- |
| F-1 | Provider error mid-stream | `error` event with `UPSTREAM_ERROR` | Caught in route handler; assistant row persisted with `content: []` (F-12) |
| F-2 | Provider timeout (`AI_TIMEOUT_MS`) | `error { code: 'UPSTREAM_TIMEOUT' }` | AbortController on the underlying fetch; route emits the error event |
| F-3 | Tool execute throws | Loop continues with `error-text` tool result | Caught in tool wrapper; `tool-call-result.isError = true` |
| F-5 | Step cap hit | `step { reason: 'capped' }` then `metadata` | `stopWhen: stepCountIs(MAX_AGENT_STEPS)` in `streamText` |
| F-7 | Migration / boot failure | Process exits non-zero before `boot.listening` | `bun run migrate` is the entrypoint's first call; surfaces in compose logs |
| F-11 | Client disconnects mid-stream | Stream closes silently; assistant row stays empty | streamSSE awaits the iterator; on disconnect the iteration ends |
| F-12 | Locked policy: never persist half-built content | Empty assistant row on terminal error | enforced in `agent/translate.ts` finalization |
| NFR-3 | Any failure | Process keeps serving / restarts cleanly | `unless-stopped` restart policy in compose |
| NFR-7 | 10 concurrent streams | All settle without deadlock | sqlite WAL + per-request transaction scope |
| NFR-8 | No orphan `tool_use` without `tool_result` | Cap fires mid-tool-call cleanly | DB integrity test in slice-6 plan I-3 |

### Frontend (Phase 2)

| ID | Trigger | Symptom | Mitigation |
| --- | --- | --- | --- |
| UI-F-1 | Backend down / connection refused | Composer spins | `phase = 'error'` with synthetic `NETWORK_ERROR`; ErrorPill copy |
| UI-F-2 | Backend returns 4xx JSON envelope | No SSE opens | Read response as JSON; ErrorPill with `code` + `message` |
| UI-F-3 | Stream closes without `metadata` or `error` | Indeterminate loading | Defensive timeout (`AI_TIMEOUT_MS + 5s`); ErrorPill with `STREAM_TRUNCATED` |
| UI-F-4 | Markdown parser throws | Component crash potential | Error boundary around `<AssistantMessage>` (slice 17 polish target); falls back to plain text |
| UI-F-5 | Orphan tool-result with no matching tool-call | Display anomaly | Skip orphan + console warn; backend already prevents (NFR-8) |
| UI-F-6 | DELETE returns 400 INVALID_TARGET | User clicked Delete on assistant row | UI guards (Delete only on user-of-turn); toast on the rare slip |
| UI-F-7 | Conversation list refresh loop | UX jitter | No live polling — refresh only after `done` / `error` of an active turn |
| UI-F-8 | User looks for a Rename affordance | Not present | Deliberate (§6.4); only Delete in the conv-row menu |
| UI-F-9 | Reload mid-stream | Empty assistant slot persisted | Re-prompt manually (§6.10) |

### Voice (Phase 3)

| ID | Trigger | Symptom | Mitigation |
| --- | --- | --- | --- |
| V-F-1 | User denies mic permission | `error.error === 'not-allowed'` | S-5 banner ("Microphone permission denied…"); mic icon → Lock |
| V-F-2 | Browser doesn't expose Web Speech (Firefox-default) | Mic click would throw | Hook lands in `unsupported`; mic stays disabled with explanatory `title` |
| V-F-3 | Browser doesn't expose `speechSynthesis` | TTS toggle would throw | Hook lands in `unsupported`; toggle stays disabled |
| V-F-4 | No installed TTS voices | `speak()` is a silent no-op | Detect at first `play()`; fall through to `error` with code `INVALID_INPUT` |
| V-F-5 | Long message exceeds Chrome's ~15 s utterance cap | Speech truncates | `chunkText(≤500)` + queued `onend → speak(next)` |
| V-F-6 | User toggles TTS off mid-utterance | Audio must abort cleanly | `useTts.stop()` → `speechSynthesis.cancel()` |
| V-F-7 | Two turns settle in quick succession | Audio overlap | Single-utterance invariant; new `play()` cancels prior |
| V-F-8 | iOS Safari first-load | Auto-play silently fails until user gesture | Documented (§6.7); not worked around |
| V-F-9 | Network / `no-speech` / `aborted` STT error | Generic toast | Return to `idle`; partial transcript discarded |

### DevOps (Phase 4)

| ID | Trigger | Symptom | Mitigation |
| --- | --- | --- | --- |
| D-F-1 | Migration script fails on boot | `/health` never returns 200; compose times out the dependent frontend | Entrypoint exits non-zero; surfaces via `docker logs` |
| D-F-2 | `OPENROUTER_API_KEY` missing | `/api/chat` 500s; `/health` is fine | `.env.example` annotates `[REQUIRED]`; README's Run-with-Docker step has `cp .env.example .env` |
| D-F-3 | nginx buffers SSE | Stream arrives in a single chunk at end | `proxy_buffering off` in `frontend/nginx.conf` (load-bearing comment) |
| D-F-4 | Stale build artifacts | Code changes don't take | `docker compose up --build` documented; CI uses `--build` unconditionally |
| D-F-5 | sqlite volume permission denied | DB writes fail | Dockerfile `chown -R 1001:0 /data` + named volume in compose |
| D-F-6 | Bun version drift | Local works, container fails | `oven/bun:1-slim` pins major; CI uses `oven-sh/setup-bun@v2` with version pin |

---

## 8. Out of scope

Documented as **deliberately not built**, not as future work.

- **Phase 1 / Backend** — REST CRUD pagination, full-text search across conversations, websocket alternative to SSE, multi-tenant auth, audit logging.
- **Phase 2 / Frontend** — Rename conversation; live conversation-list polling; mid-stream reload resume; optimistic-UI for non-delete mutations; streaming retry; multi-tab sync; message edit; cross-conversation search; Storybook (the dev-only `/__components` gallery covers the visual review need); backend extensions to recover live-only ornaments (declined in spec §1.4).
- **Phase 3 / Voice** — Wake-word / hotword; multi-language STT/TTS (locked to `en-US`); voice-only mode; voice cloning; backend persistence of synthesized audio; voice consistency across devices; mid-stream TTS resume across reloads; server-side TTS fallback when the browser can't synthesize.
- **Phase 4 / DevOps** — Hosted deployment (fly.io / railway / AWS); TLS / reverse-proxy hardening; multi-replica backend; container observability (Prometheus / Grafana); database migrations rollback (Drizzle's forward-only model); automated sqlite volume backups.

---

## 9. Acceptance items per phase

### Phase 2 — twelve-item verifiable list

1. `cd frontend && bun test` — all green ✅
2. `cd frontend && bun run typecheck` — clean ✅
3. With backend on `:8787`, frontend on `:5173` opens the chat UI ✅
4. Sending the canonical healthcare prompt streams text + reasoning + tool pills (with live `0.7s`-style duration) + footer ✅
5. Reload renders identically via the history path with **L1/L2/L3** degradations ✅
6. Delete user-of-turn → entire turn cascades; positions renumber ✅
7. Mid-stream error → `<ErrorPill>` with code-specific copy ✅
8. Capped scenario → `<CappedNotice>` + metadata live; gone on reload ✅
9. Light/dark global; mobile (390 px) renders ✅
10. Voice components disabled-with-tooltip in Phase 2 (lifted in Phase 3) ✅
11. Sidebar conv-row has Delete-only menu (with confirm) ✅
12. Recording-ready continuous demo ✅

### Phase 3 — voice

1. `bun test` — backend stays at 170 / 170 ✅ (Phase 3 ships zero backend changes)
2. `bun run test` — frontend green incl. STT/TTS hook tests ✅
3. Live: speak → transcript → submit → answer streams + auto-plays via `<AudioPlayer>` ✅
4. Mic permission-denied state matches design's S-5 ✅
5. Browser unsupported → mic disabled with "not supported in this browser" ✅
6. Recording-ready end-to-end voice flow ✅

### Phase 4 — devops

1. `docker-compose.yml` brings up backend + frontend with one command ✅
2. `Dockerfile` minimal, prod deps only, non-root ✅
3. Migrations run before backend accepts traffic ✅
4. `.env.example` documents required / default / secret per variable ✅
5. (Bonus) GitHub Actions builds, ups, polls `/health`, runs tests, fails fast ✅

---

## 10. References

For the full original context behind any section above:

| Source | What |
| --- | --- |
| `specs/archive/phase-1-agentic-streaming-backend.md` | Phase 1 spec (full §2 data model, §3.2.1 SSE taxonomy, §7 failure modes, §9 deviations) |
| `specs/archive/phase-1-slice-6-test-plan.md` | I-1 through I-11 backend test scenarios (used as MSW fixtures in Phase 2) |
| `specs/archive/phase-1-data-model-review.md` | Pre-Phase-1 review of Step 0.5 invariants (UNIQUE position, role check, single usage row) |
| `specs/archive/phase-1-multi-phase-plan-original.md` | The four-phase plan as originally drafted |
| `specs/archive/phase-1-spec-review.md` | Pre-implementation spec critique |
| `specs/archive/phase-2-frontend.md` | Phase 2 spec (§1.4 reload-state limitations, §3.2 reducer table, §6 acceptance, §7 failure modes) |
| `specs/archive/phase-2-ui-design-brief-original.md` | The UI design brief that produced the Claude Design handoff |
| `specs/archive/phase-3-voice.md` | Phase 3 spec (§3.3-3.4 STT/TTS state machines, §6 trade-offs, §5 V-F-* failure modes) |
| `specs/archive/phase-4-deploy-ci.md` | Phase 4 spec (Dockerfile + compose + CI; §5 D-F-* failure modes) |
| `README.md` | Project overview, Run-with-Docker quickstart, demo script |
| `CLAUDE.md` | Working agreement, common commands, conventions per phase |
| `frontend/src/lib/chat-events.ts` | Frontend wire-format mirror (the authoritative TS source for §3.4 / §3.6) |
| `backend/src/db/schema.ts` | Drizzle SQLite schema (the authoritative source for §3.1) |
| `backend/src/lib/pricing.ts` | OpenRouter model registry (referenced in §5 Phase 1) |
| `git log --oneline --grep="slice"` | Slice-by-slice development arc, slices 1 → 25 |
