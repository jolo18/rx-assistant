# Implementation Plan — Healthcare Agentic Chat

## Context

The user (`louijose@gmail.com`) is tackling a Senior Full-Stack Engineer take-home: a healthcare-domain agentic chat system. The project directory `/Users/jolo/Documents/rx-assitant/` currently holds only `ASSIGNMENT.md` — this is greenfield. The work is time-boxed (6–8 hours, single narrated recording), and `docker compose up` must succeed first try. This plan converts the spec into a concrete, end-to-end build path with file paths, library picks, and verification steps.

## Resolved Decisions

| Area | Choice | Why |
| --- | --- | --- |
| AI provider | **Anthropic Claude Sonnet 4.6** (`@anthropic-ai/sdk`) | Native `thinking` blocks → reasoning panel; `tool_use`/`tool_result` blocks → clean stream taxonomy. |
| Backend runtime | **Bun + TypeScript + Hono** | Required by spec; Hono is Bun-native, tiny, has SSE helpers. |
| Database | **SQLite** via `bun:sqlite` + **Drizzle ORM** | File-backed, mounted as Docker volume; Drizzle gives typed schema + `drizzle-kit` migrations. |
| Stream protocol | **SSE** with typed events | Distinguishes text / tool / metadata as required. |
| Healthcare tools | **`drug_info`** (openFDA) + **`symptom_lookup`** (seeded JSON) | Public data, zero-PHI. |
| Frontend | **Vite + React + TypeScript** | Fast dev loop; static build deploys behind nginx. |
| Markdown | **`react-markdown` + `remark-gfm` + `rehype-highlight`** | GFM tables, code highlighting. |
| Streaming hook | Custom hook over `fetch` + `ReadableStream` | EventSource doesn't support POST; manual SSE parse is ~30 lines. |
| STT | **Browser Web Speech API** (`webkitSpeechRecognition`) | Zero infra, live interim transcripts, simple permission UX. |
| TTS | **OpenAI `tts-1`** behind backend `/api/tts` | Single API key, returns mp3 stream, plays via `<audio>`. |
| Container | Multi-stage Dockerfile, distroless-ish final stage, non-root user | Spec requires minimal + non-root. |
| CI (bonus) | GitHub Actions: build → compose up → curl health → run tests | Fail fast on non-zero. |

## Repository Layout

```
rx-assitant/
├── ASSIGNMENT.md
├── README.md                       # run instructions + recording link
├── PLAN.md                         # this plan (copied here post-approval)
├── docker-compose.yml
├── .env.example
├── .github/workflows/ci.yml
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── drizzle.config.ts
│   ├── src/
│   │   ├── index.ts                # Hono app entry, routes, CORS, error handler
│   │   ├── db/
│   │   │   ├── client.ts           # Drizzle + bun:sqlite
│   │   │   ├── schema.ts           # conversations, messages, usage
│   │   │   └── migrations/         # drizzle-kit generated
│   │   ├── agent/
│   │   │   ├── loop.ts             # multi-step agent loop, max-step cap
│   │   │   ├── tools.ts            # tool registry + JSON schemas
│   │   │   ├── tools/
│   │   │   │   ├── drug_info.ts
│   │   │   │   └── symptom_lookup.ts
│   │   │   └── stream.ts           # SSE event encoder
│   │   ├── routes/
│   │   │   ├── chat.ts             # POST /api/chat (SSE)
│   │   │   ├── conversations.ts    # GET /api/conversations/:id, DELETE /api/messages/:id
│   │   │   ├── tts.ts              # POST /api/tts → mp3
│   │   │   └── health.ts           # GET /health
│   │   ├── lib/
│   │   │   ├── pricing.ts          # token → USD by model
│   │   │   ├── errors.ts           # structured error helper
│   │   │   └── validate.ts         # zod schemas
│   │   └── data/
│   │       └── symptoms.json       # seeded symptom lookup data
│   └── tests/
│       ├── agent.test.ts
│       ├── tools.test.ts
│       └── routes.test.ts
└── frontend/
    ├── Dockerfile                  # build → nginx
    ├── nginx.conf                  # proxies /api → backend
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/client.ts           # fetch + SSE parser
        ├── hooks/
        │   ├── useChatStream.ts    # streaming state machine
        │   ├── useSpeechInput.ts   # Web Speech API + auto-submit
        │   └── useTTS.ts           # fetch /api/tts + audio cache
        ├── components/
        │   ├── Chat.tsx
        │   ├── MessageList.tsx
        │   ├── Message.tsx         # markdown + metadata + delete
        │   ├── ToolCall.tsx        # pending/running/complete states
        │   ├── ReasoningPanel.tsx  # collapsible, streaming indicator
        │   ├── Composer.tsx        # textarea + mic + TTS toggle + send
        │   ├── AudioPlayer.tsx     # auto-play latest, manual for older
        │   └── ui/                 # buttons, spinner, etc.
        └── styles/
            └── app.css             # CSS variables + layout (no Tailwind)
```

## Part 1 — Backend Detail

### Database schema (`backend/src/db/schema.ts`)

```ts
conversations(id TEXT PK, created_at INTEGER, updated_at INTEGER)
messages(
  id TEXT PK, conversation_id TEXT FK, role TEXT,            -- user|assistant
  content TEXT,                                              -- JSON: ordered content blocks
  created_at INTEGER, position INTEGER
)
usage(
  id TEXT PK, message_id TEXT FK, model TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_create_tokens INTEGER,
  latency_ms INTEGER, cost_usd REAL, created_at INTEGER
)
```

Storing assistant `content` as a JSON array of typed blocks (`{type:'text'|'thinking'|'tool_use'|'tool_result', ...}`) preserves the exact stream structure on reload — the UI can render historical tool calls and reasoning identically to live ones.

### Agent loop (`backend/src/agent/loop.ts`)

```
function runAgent({ conversationId, userMessage, sse }) {
  const history = loadHistory(conversationId)
  history.push({ role: 'user', content: userMessage })
  let steps = 0
  while (steps++ < MAX_STEPS /* 8 */) {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      thinking: { type: 'enabled', budget_tokens: 2000 },
      tools: TOOL_DEFS,
      messages: history,
      max_tokens: 4096,
    })
    for await (const ev of stream) sse.emit(mapEvent(ev))   // text-delta | reasoning-delta | tool-call-*
    const final = await stream.finalMessage()
    history.push({ role: 'assistant', content: final.content })
    const toolUses = final.content.filter(b => b.type === 'tool_use')
    if (!toolUses.length) break
    const toolResults = await Promise.all(toolUses.map(runTool))
    sse.emit({ type: 'tool-call-result', ... })
    history.push({ role: 'user', content: toolResults })
  }
  saveHistory(conversationId, history)
  recordUsage(...)
  sse.emit({ type: 'metadata', tokens, latency, costUSD })
  sse.emit({ type: 'done' })
}
```

Wrapped in `try/catch` → on AI error or timeout, emit `{ type: 'error', message }`, persist what we have, close the stream cleanly.

### SSE event taxonomy

| Event | Payload |
| --- | --- |
| `text-delta` | `{ messageId, delta }` |
| `reasoning-delta` | `{ messageId, delta }` |
| `tool-call-start` | `{ id, name, input? }` |
| `tool-call-delta` | `{ id, partialInput }` (incremental JSON args) |
| `tool-call-result` | `{ id, output, isError }` |
| `metadata` | `{ messageId, model, tokens, latencyMs, costUSD }` |
| `done` | `{ messageId }` |
| `error` | `{ code, message }` |

### Tools

- **`drug_info(query: string)`** → `GET https://api.fda.gov/drug/label.json?search=openfda.brand_name:{query}&limit=1` → return `{ name, indications, warnings, dosage }`. 5s timeout, structured error on failure.
- **`symptom_lookup(symptom: string)`** → fuzzy match against `data/symptoms.json` (~30 entries: headache, fever, chest pain, etc.). Each entry has `description`, `commonCauses`, `whenToSeekCare`, plus a hard-coded "this is informational, not medical advice" disclaimer the agent is instructed to surface.

### Validation & errors

- `zod` schemas at every route boundary (`lib/validate.ts`).
- `lib/errors.ts` exports `httpError(status, code, message)` returning `{ error: { code, message } }`.
- Anthropic call wrapped with a 60s `AbortController`.

### Pricing (`lib/pricing.ts`)

Static table per model: `claude-sonnet-4-6` → `$3/MTok` input, `$15/MTok` output. `cost = (in*3 + out*15)/1e6`.

## Part 2 — Frontend Detail

### Streaming hook (`useChatStream.ts`)

State machine per assistant message:

```
idle → submitting → streaming → done | error
```

- POST to `/api/chat`, read `response.body.getReader()`, parse SSE frames (`event:` + `data:` JSON).
- Append to a single message object in React state — text deltas concat to `text`, reasoning deltas to `thinking`, tool events upsert by `id` into `toolCalls[]` with status transitions (`pending` on start → `running` while args streaming → `complete` on result).
- Loading indicator shows while state is `submitting` (no first token yet).

### Component contracts

- **`Message`** — switches on `role`. Assistant: renders interleaved blocks in stream order (text → markdown, reasoning → `<ReasoningPanel>`, tool → `<ToolCall>`). Footer: timestamp · model · tokens · cost · delete.
- **`ToolCall`** — three visual states (gray dot pending / spinning ring running / green check complete), expandable to show `input` (JSON) and `output` (formatted).
- **`ReasoningPanel`** — collapsed by default, header reads "Thinking..." with a pulsing dot while streaming, "Thoughts" when done.
- **`Composer`** — textarea, mic toggle, TTS toggle, send button. Submit on Enter (Shift+Enter for newline).

### Voice

- **`useSpeechInput`** — `new (window.SpeechRecognition || window.webkitSpeechRecognition)()`, `continuous = true`, `interimResults = true`. On `result` → set input value to interim+final. Debounce 1.2s of silence → auto-submit. On `not-allowed` error → toast "Microphone permission denied. Enable it in your browser settings."
- **`useTTS`** — when assistant message hits `done` and TTS toggle is on, POST `{ text }` to `/api/tts`, get mp3 blob, cache by messageId. Auto-play if `messageId === latestAssistantId`. Older messages render `<AudioPlayer>` with native `<audio controls>` (gives play/pause/seek/volume free). Errors swallowed.

### Loading state on first paint

`fetch('/api/conversations/:id')` blocks initial render behind a spinner; conversation hydrated into state before mounting `MessageList`.

### Delete

`DELETE /api/messages/:id` → server cascades nothing (single-row delete) and re-numbers `position`. Client optimistically removes; rollback on 4xx/5xx.

## Part 3 — Voice Implementation Notes

- Web Speech API only works in Chromium-based browsers — note this in README.
- TTS endpoint streams mp3: `Content-Type: audio/mpeg`, body is OpenAI's response body piped through. No buffering server-side.
- TTS is fire-and-forget from the UI's perspective — failures log to console and surface no toast (spec says fail silently).

## Part 4 — DevOps Detail

### `docker-compose.yml`

```yaml
services:
  backend:
    build: ./backend
    env_file: .env
    volumes: ["sqlite-data:/data"]
    ports: ["8787:8787"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8787/health"]
      interval: 5s
      timeout: 3s
      retries: 10
  frontend:
    build: ./frontend
    depends_on:
      backend: { condition: service_healthy }
    ports: ["3000:80"]
volumes:
  sqlite-data:
```

No separate DB service — SQLite lives in the volume. Frontend gates on backend health, so a clean `docker compose up` waits for migrations + first health pass before exposing the UI.

### Backend `Dockerfile`

```dockerfile
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY docker-entrypoint.sh ./
RUN chown -R app:app /app && chmod +x docker-entrypoint.sh
USER app
HEALTHCHECK --interval=5s CMD wget -qO- http://localhost:8787/health || exit 1
EXPOSE 8787
ENTRYPOINT ["./docker-entrypoint.sh"]
```

`docker-entrypoint.sh`:

```sh
#!/bin/sh
set -e
bun run drizzle-kit migrate     # runs before server start
exec bun run dist/index.js
```

This satisfies "automated migration step that runs before backend accepts traffic" — health check stays red until the server binds.

### `.env.example`

```
# Required (secrets)
ANTHROPIC_API_KEY=               # secret — get from console.anthropic.com
OPENAI_API_KEY=                  # secret — used only for TTS

# Required (with defaults)
PORT=8787
DATABASE_URL=file:/data/app.db
ANTHROPIC_MODEL=claude-sonnet-4-6
TTS_MODEL=tts-1
TTS_VOICE=alloy
MAX_AGENT_STEPS=8
AI_TIMEOUT_MS=60000

# Optional
LOG_LEVEL=info
```

### CI (`.github/workflows/ci.yml`)

```
- checkout
- setup-bun
- bun install (backend + frontend)
- bun test (backend)
- docker compose build
- docker compose up -d
- wait-on http://localhost:8787/health (60s)
- curl smoke test against /api/chat
- docker compose down
```

`set -e` semantics via `fail-fast: true` and exit-on-error in each step.

## README outline

1. What this is + screen recording link
2. Quickstart: copy `.env.example` → `.env`, fill keys, `docker compose up`
3. Local dev: `bun install` per workspace, `bun dev`
4. Architecture: short tour of `backend/` and `frontend/`, link to schema
5. Tools the agent has + how to add one
6. Library choices & tradeoffs (why Hono, why SQLite, why Web Speech)
7. Known limitations (Chromium-only STT, single-user)

## Build Order (sequenced for the recording)

1. **Scaffold** — both workspaces, Hono "hello", Vite "hello", talking via CORS proxy. (~30 min)
2. **DB + migrations** — Drizzle schema, generate, apply, entrypoint script. Health endpoint. (~30 min)
3. **Anthropic streaming, no tools** — `/api/chat` SSE, persist messages, frontend renders text deltas + markdown. Show working stream early — biggest demo payoff. (~75 min)
4. **Tool loop** — register two tools, agent loop with cap, SSE tool events, frontend `<ToolCall>` component. (~75 min)
5. **Reasoning panel + metadata + delete + history hydration** — polish Part 2. (~60 min)
6. **Voice in** — Web Speech hook + auto-submit + permission UX. (~30 min)
7. **Voice out** — `/api/tts` + audio player + auto-play latest. (~30 min)
8. **Docker** — compose up cold-start verification. (~45 min)
9. **CI + README + recording wrap.** (~30 min)

Total ~6.5h with slack for narration/debug.

## Verification

End-to-end checks once built:

- `docker compose up` from a clean clone → both services healthy, no manual steps.
- Open `http://localhost:3000`, send "What's the dosage range for ibuprofen and what symptoms warrant calling a doctor?" → tokens stream live; both tools fire inline; reasoning panel pulses then stops; metadata footer shows tokens + cost.
- Reload the page → conversation hydrates with tool calls and reasoning intact (proves JSON content blocks survive round-trip).
- Toggle TTS → latest reply auto-plays; older messages have manual controls.
- Click the mic → speak → input updates live → auto-submits ~1.2s after silence.
- Negative paths:
  - Bad `ANTHROPIC_API_KEY` → structured error event, UI shows inline error, no crash.
  - Deny mic → friendly "permission denied" message.
  - `OPENAI_API_KEY` blank → TTS quietly does nothing, chat still works.
- `bun test` in `backend/` passes.
- GitHub Actions run is green.

## Critical Files to Create

- `backend/src/agent/loop.ts` — the heart of Part 1.
- `backend/src/agent/stream.ts` — SSE event encoder; the contract between back and front.
- `backend/src/db/schema.ts` — content stored as JSON blocks is the key design call.
- `frontend/src/hooks/useChatStream.ts` — front-end side of that contract.
- `frontend/src/components/Message.tsx` + `ToolCall.tsx` + `ReasoningPanel.tsx` — render the structured stream.
- `docker-compose.yml` + `backend/Dockerfile` + `docker-entrypoint.sh` — Part 4 must work first try.
- `.env.example` + `README.md` — submission gates.
