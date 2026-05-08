# Rx Assistant

A streaming agentic chat for healthcare information, built as a senior full-stack take-home (`ASSIGNMENT.md`). Two-tier app:

- **`backend/`** — Bun + Hono + Vercel AI SDK + OpenRouter, persisted in SQLite via Drizzle. Streams Server-Sent Events over `POST /api/chat` with reasoning, tool-call, text, and metadata frames.
- **`frontend/`** — Vite + React 19 + TypeScript + react-router-dom v7. Consumes the SSE stream over `fetch + ReadableStream` (no `EventSource` — `POST` not supported), renders reasoning panels, tool pills, markdown answers, and message footers; same renderer drives both live streaming and historical replay.

Two tools are wired: `drug_info` (a small offline drug database) and `symptom_lookup` (seeded JSON). Conversations + messages + token usage are persisted; reload picks up exactly where it left off, with the documented live-only ornaments stripped (see "Limitations" below).

---

## Quick start

You'll need [Bun ≥ 1.3](https://bun.sh) and an [OpenRouter API key](https://openrouter.ai/keys).

```sh
git clone <this-repo> rx-assistant
cd rx-assistant

# Backend
cd backend
cp .env.example .env       # then put your OPENROUTER_API_KEY in
bun install
bun run migrate            # creates ./data/app.db
bun run dev                # listens on :8787 (pretty logs: bun run dev:pretty)

# Frontend (in a second terminal)
cd ../frontend
bun install
bun run dev                # opens http://localhost:5173
```

`vite.config.ts` proxies `/api/*` → `http://localhost:8787`, so the frontend talks to the backend without CORS gymnastics.

### Required env (backend)

| Variable | Required? | Default | Purpose |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | — | https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | no | `anthropic/claude-sonnet-4.6` | Must be in `backend/src/lib/pricing.ts` |
| `MAX_AGENT_STEPS` | no | `8` | Cap for the multi-step tool loop |
| `AI_TIMEOUT_MS` | no | `60000` | Whole-stream upstream budget |
| `TOOL_TIMEOUT_MS` | no | `5000` | Per-tool execute budget |
| `DATABASE_PATH` | no | `./data/app.db` | bun:sqlite path |
| `PORT` | no | `8787` | HTTP port |
| `LOG_LEVEL` | no | `info` | pino level (`silent`…`trace`) |

See `backend/.env.example` for the full set including pricing-model registry.

---

## Demo script (recording-ready)

Each prompt below exercises a different slice of the wire format. With both servers running, fire them in order:

| # | Prompt | What to watch | Spec ids |
| --- | --- | --- | --- |
| 1 | *"What is ibuprofen and what are the key warnings?"* | text-only stream — reasoning panel pulses while streaming, settles to "Thoughts", text streams token-by-token, message footer shows live tokens / cost / `0.7s`-style tool durations once `metadata` arrives | I-1, I-1r |
| 2 | *"Look up dextromethorphan dosage"* | full tool round-trip — `drug_info` pill goes pending → running → success with a green check, then the answer streams. Two SSE rounds (`tool-calls` finish + `stop` finish) | I-2 |
| 3 | *"I have a persistent dry cough — what could cause it?"* | the other tool — `symptom_lookup` pill, deflist output | FR-5 |
| 4 | Pinch-zoom the browser to mobile width (or DevTools 390px) | layout reflows: sidebar becomes a hidden sheet behind a hamburger top bar, bubbles cap at 86%, prompt grid is 1col | DoD slice 17 |
| 5 | Reload the page on `/c/<id>` | identical render via the history-load path. **Note the documented degradations**: tool durations show "Complete" instead of `0.7s`, and `<CappedNotice>`/`<ErrorPill>` are not re-rendered (live-only — see L1/L2/L3) | acceptance §6.5 |
| 6 | Click the `…` on an assistant footer → Delete → confirm | `DELETE /api/messages/:id` cascades the whole turn (user → assistant → tool → assistant), positions renumber, sidebar list refreshes | acceptance §6.6 |
| 7 | Set `OPENROUTER_API_KEY` to garbage and restart backend, then prompt | mid-stream error path — `<ErrorPill>` renders with code-specific copy ("Took too long…", "Service is busy…", etc.). Reload after the error: persisted user message + empty assistant row, no pill (documented L2). | acceptance §6.7 |
| 8 | Set `MAX_AGENT_STEPS=2`, restart, then prompt for a multi-tool query | step-cap path — `<CappedNotice>` ("Stopped after the maximum number of reasoning steps") appears live, then `metadata` settles. Reload: notice gone (live-only L1). | acceptance §6.8 |
| 9 | Toggle theme (sidebar foot) | global light↔dark, all surfaces re-tint via `[data-theme]` selectors against the design tokens | acceptance §6.9 |
| 10 | Hover the disabled mic / TTS in the composer | native `title` tooltip — "Voice input arrives in Phase 3" / "Spoken replies arrive in Phase 3" | acceptance §6.10 |

Stop after #10 — that's the recording.

---

## Architecture

```
                       ┌────────────────────────────────────────────────────────────┐
                       │ frontend                                                   │
                       │                                                            │
  POST /api/chat       │  ChatPage                                                  │
  (SSE)                │   ├─ Sidebar (useConversations)                            │
  ──────────────────▶  │   ├─ MessageList                                           │
                       │   │   ├─ historical turns ←── groupIntoTurns(messages)     │
                       │   │   └─ live turn       ←── useChatStream state machine   │
                       │   │                          (useReducer over §3.2 union)  │
                       │   │                          ←── parseChatEvent + parseSSE │
                       │   └─ Composer (text only — voice disabled)                 │
                       └────────────────────────────────────────────────────────────┘
                                          ▲
                                          │  fetch + ReadableStream + TextDecoder
                                          │  (EventSource doesn't POST)
                                          ▼
                       ┌────────────────────────────────────────────────────────────┐
                       │ backend                                                    │
                       │                                                            │
                       │  Hono routes                                               │
                       │   ├─ POST /api/chat — Vercel AI SDK fullStream → SSE       │
                       │   ├─ GET  /api/conversations[/:id]                         │
                       │   ├─ POST /api/conversations                               │
                       │   ├─ DELETE /api/conversations/:id                         │
                       │   ├─ DELETE /api/messages/:id                              │
                       │   └─ GET  /health                                          │
                       │                                                            │
                       │  Agent loop                                                │
                       │   ├─ streamText({ tools: { drug_info, symptom_lookup } })  │
                       │   ├─ translate(part) → SSEEvent                            │
                       │   └─ stopWhen: stepCountIs(MAX_AGENT_STEPS)                │
                       │                                                            │
                       │  Persistence (SQLite + Drizzle, JSON content blob/row)     │
                       │   conversations · messages · usage                         │
                       └────────────────────────────────────────────────────────────┘
```

The wire-format taxonomy lives in `specs/archive/phase-1-agentic-streaming-backend.md` §3.2.1 (12 events: `start`, `text-delta`, `reasoning-{start,delta,end}`, `tool-call-{start,delta,end,result}`, `step`, `metadata`, `error`). The frontend mirror is `frontend/src/lib/chat-events.ts`, parsed off the SSE stream by `frontend/src/lib/sse-parse.ts`.

---

## Project layout

```
.
├── ASSIGNMENT.md                 # the take-home brief
├── CLAUDE.md                     # working agreement / project conventions
├── README.md                     # this file
├── backend/                      # Phase 1 — closed (170 / 170 tests)
│   ├── src/
│   │   ├── agent/                # streamText + translate(part) → SSE
│   │   ├── db/                   # drizzle schema + migrate runner
│   │   ├── routes/               # /api/chat (SSE) + JSON CRUD
│   │   ├── repos/                # SQLite layer
│   │   ├── lib/                  # pricing, env, logger, errors
│   │   └── index.ts              # boot + Bun.serve idleTimeout: 0
│   └── tests/                    # 28 files / 170 tests
├── design/                       # Claude Design handoff (HTML/JSX/CSS)
├── frontend/                     # Phase 2 — what slices 9-18 land
│   ├── src/
│   │   ├── components/           # 13 components + icons
│   │   ├── hooks/                # useChatStream, useTheme, useConversation(s)
│   │   ├── lib/                  # api wrappers, chat-events, sse-parse, turns
│   │   ├── pages/                # ChatPage + ComponentGallery (dev only)
│   │   ├── styles/               # tokens.css + components.css ported verbatim
│   │   ├── App.tsx               # BrowserRouter + ChatStreamProvider
│   │   └── main.tsx
│   └── tests/                    # 175 tests across components / hooks / integration / pages
└── specs/                        # frozen for traceability
    ├── phase-2-frontend.md       # the active spec
    └── archive/                  # phase 1 + slice-6 test plan
```

---

## Tests

```sh
cd backend && bun test            # 170 / 170
cd frontend && bun run test       # 175 / 175 (vitest)
cd frontend && bun run typecheck  # tsc -b --noEmit, clean
```

Frontend integration tests use **MSW v2** to mock the SSE `/api/chat` endpoint with realistic event sequences pulled straight from the spec (I-1, I-1r, I-2, I-2e, I-3, I-8, I-9). Reload-history tests assert the L1/L2/L3 documented degradations.

A dev-only **component gallery** at `http://localhost:5173/__components` (or `?gallery=1`) renders every component state — including all `<ErrorPill>` codes and the `<FormattedToolOutput>` empty / 404 / error branches.

---

## Limitations (deliberate, see `specs/phase-2-frontend.md` §1.4)

- **L1 — `<CappedNotice>` is live-only.** `step.reason` isn't persisted; reload drops the notice.
- **L2 — `<ErrorPill>` is live-only.** Backend persists an empty assistant row on terminal error (F-12), no terminal error code stored.
- **L3 — Tool durations are live-only.** `tool-call-result.durationMs` isn't persisted; the historical badge says "Complete".
- **No conversation rename.** Backend has no `PATCH /api/conversations/:id`. Title remains auto-derived from the first 60 chars of the first user message.
- **No mid-stream resume after page reload.** POST is not idempotent; user re-prompts manually if they reload before settle.
- **Voice (mic + TTS) is Phase 3.** Buttons are visible but `disabled` with native `title` tooltips ("Voice input arrives in Phase 3" / "Spoken replies arrive in Phase 3"). `<AudioPlayer>` exists in the design source but is not mounted.

---

## Phase 1 closed at `62f81f3`

Backend ships unchanged from there. All Phase 2 work is in `frontend/`. Slice-by-slice commit history: `git log --oneline --grep="slice"`.
