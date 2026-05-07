# Phase 1 Spec — Agentic Streaming Backend

> **Scope:** Part 1 of `ASSIGNMENT.md` only — the TypeScript + Bun backend that streams an agent's response, handles multi-step tool calling, persists conversations, tracks usage, and degrades gracefully.
> **Out of scope:** React UI (Phase 2), voice (Phase 3), Docker/CI (Phase 4).

---

## 1. Requirements

### 1.1 Functional Requirements

| ID | Requirement | Source |
| --- | --- | --- |
| FR-1 | Expose a streaming chat endpoint that accepts `{ message, conversationId }`. | Assignment §Part 1 |
| FR-2 | Response must stream incrementally; clients receive bytes before generation completes. | §Part 1 |
| FR-3 | Stream payload must structurally distinguish **assistant text**, **tool activity**, and **completion metadata** (i.e., a typed event taxonomy, not a single text channel). | §Part 1 |
| FR-4 | Agent loops automatically: tool call → result ingestion → continued reasoning → final answer, without client re-prompting. | §Part 1 |
| FR-5 | At least **two healthcare-relevant tools** are registered and callable by the model. | §Part 1 |
| FR-6 | Agent execution is capped at a configurable max-step count; exceeding the cap ends the loop cleanly with a final assistant message. | §Part 1 |
| FR-7 | Conversation history is loaded before each request (full prior turns + tool results). | §Part 1 |
| FR-8 | Conversation history is saved after each completed response, preserving content block structure (text, thinking, tool_use, tool_result). | §Part 1 |
| FR-9 | Per-response usage is persisted: input tokens, output tokens, latency (ms), estimated cost (USD), model name. | §Part 1 |
| FR-10 | Usage records are retrievable by conversation and by message. | §Part 1 |
| FR-11 | All inbound payloads are validated; malformed inputs return a structured 4xx error without invoking the model. | §Part 1 |
| FR-12 | Errors return a stable JSON shape `{ error: { code, message } }` (HTTP) or an SSE `error` event (mid-stream). | §Part 1 |
| FR-13 | Conversations and messages are individually addressable: conversations via GET, messages via DELETE (user-message ids only — see §3.3). Per-message GET is unnecessary because conversation load returns full message rows. | Phase 2 dependency |
| FR-14 | When `conversationId` is **absent** from the request body, the server creates a new conversation. When it is **present but unknown**, the server returns 404 (F-10). | UX implied |
| FR-15 | Health endpoint returns 200 once migrations have run and the DB is reachable. | Phase 4 dependency |

### 1.2 Non-Functional Requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-1 | **Stream latency overhead** added by our server vs. raw provider stream | < 50 ms per chunk p95 |
| NFR-2 | **AI call timeout** | configurable, default 60 s; on timeout the stream emits `error` and closes |
| NFR-3 | **Resilience** | uncaught exceptions in any route do not crash the process |
| NFR-4 | **Validation** | every request body is parsed with a schema; type-narrowed thereafter |
| NFR-5 | **Cold start** | container ready (migrations done, server listening) within 5 s |
| NFR-6 | **Memory** | < 256 MB resident under one concurrent stream |
| NFR-7 | **Concurrency** | safely supports ≥ 10 concurrent streaming requests on dev hardware |
| NFR-8 | **Determinism of persistence** | message ordering is preserved across reload; no orphan tool_use without tool_result |
| NFR-9 | **Security posture** | no PHI is required or stored by the tools we ship; API keys are env-only, never logged |
| NFR-10 | **Observability** | per-request log line with id, latency, tokens, cost, status |
| NFR-11 | **Portability** | runs in `oven/bun:1-alpine`; no native build steps required at runtime |

> **Removed:** NFR-1 (end-to-end TTFB) was unenforceable because it depended on the upstream provider. The server-side overhead remains tracked as NFR-1 (renumbered).

### 1.3 Out-of-scope (explicit non-goals for Phase 1)

- Authentication / multi-user separation. Single-tenant.
- Rate limiting (would be needed in production). The `RATE_LIMITED` error code is reserved for propagating upstream provider 429s — see §3.4.
- Streaming back partial tool *results* — tool execution is atomic from the client's perspective; only the **arguments** stream as the model emits them.
- **Conversation truncation** when the model context limit is exceeded. Known limitation — token usage grows linearly with turn count. Out of scope for Phase 1; revisit when the UI surfaces multi-turn conversations.
- Cache invalidation, prompt caching tuning.
- Embeddings / RAG.

---

## 2. Data Model

SQLite, three tables. Times stored as Unix epoch ms (`INTEGER`). All ids are ULIDs (`TEXT`) for sortable, URL-safe primary keys.

```mermaid
classDiagram
  class conversations {
    +TEXT id PK
    +TEXT title
    +INTEGER created_at
    +INTEGER updated_at
  }
  class messages {
    +TEXT id PK
    +TEXT conversation_id FK
    +TEXT role
    +TEXT content "JSON ContentPart[]"
    +INTEGER position
    +INTEGER created_at
  }
  class usage {
    +TEXT id PK
    +TEXT message_id FK UNIQUE
    +TEXT model
    +INTEGER input_tokens
    +INTEGER output_tokens
    +INTEGER cache_read_tokens
    +INTEGER cache_create_tokens
    +INTEGER latency_ms
    +REAL cost_usd
    +INTEGER created_at
  }
  conversations "1" --> "0..*" messages : has (cascade)
  messages "1" --> "0..1" usage : metered_by (cascade)
```

### 2.1 `conversations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | ULID |
| `title` | TEXT NULL | Auto-derived from first user message (first 60 chars) |
| `created_at` | INTEGER NOT NULL | epoch ms |
| `updated_at` | INTEGER NOT NULL | bumped on every message append |

### 2.2 `messages`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | ULID |
| `conversation_id` | TEXT NOT NULL | FK → `conversations.id`, ON DELETE CASCADE |
| `role` | TEXT NOT NULL CHECK | `'user' \| 'assistant' \| 'tool'` (per AI SDK `ModelMessage`; tool-result messages occupy their own row) |
| `content` | TEXT NOT NULL | JSON array of parts; see §2.4 |
| `position` | INTEGER NOT NULL | dense rank within conversation; used for ordering and re-numbering after delete |
| `created_at` | INTEGER NOT NULL | epoch ms |

Constraints: UNIQUE `(conversation_id, position)`. Index: `(conversation_id, created_at)`.

Implementation note for `deleteAndRenumber`: inside a transaction, (a) shift later rows to negative offsets `UPDATE messages SET position = -position WHERE conversation_id = ? AND position > deletedPos`, (b) delete the target row, (c) shift back with `UPDATE messages SET position = -position - 1 WHERE conversation_id = ? AND position < 0` to close the gap. The single-statement form `UPDATE … SET position = position - 1 WHERE position > deletedPos` is rejected by SQLite under the UNIQUE constraint.

### 2.3 `usage`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | ULID |
| `message_id` | TEXT NOT NULL | FK → `messages.id`, ON DELETE CASCADE; unique (one row per assistant message) |
| `model` | TEXT NOT NULL | OpenRouter id, e.g. `anthropic/claude-sonnet-4.6` |
| `input_tokens` | INTEGER NOT NULL | summed across all loop iterations |
| `output_tokens` | INTEGER NOT NULL | summed across all loop iterations |
| `cache_read_tokens` | INTEGER NOT NULL DEFAULT 0 | |
| `cache_create_tokens` | INTEGER NOT NULL DEFAULT 0 | |
| `latency_ms` | INTEGER NOT NULL | wall clock from request received → final SSE event |
| `cost_usd` | REAL NOT NULL | computed via static price table |
| `created_at` | INTEGER NOT NULL | epoch ms |

### 2.4 Content part JSON shape (stored in `messages.content`)

Mirrors the **Vercel AI SDK `ModelMessage` content-parts shape**. Storing this canonical form means we can replay history into `streamText({ messages })` verbatim, regardless of which underlying provider OpenRouter routes us to.

```mermaid
classDiagram
  class StoredMessage {
    +Role role
    +string|ContentPart[] content
  }
  class Role {
    <<enumeration>>
    user
    assistant
    tool
  }
  class ContentPart {
    <<sealed union>>
    +string type
  }
  class TextPart {
    +"text" type
    +string text
  }
  class ReasoningPart {
    +"reasoning" type
    +string text
  }
  class ToolCallPart {
    +"tool-call" type
    +string toolCallId
    +string toolName
    +unknown input
  }
  class ToolResultPart {
    +"tool-result" type
    +string toolCallId
    +string toolName
    +ToolResultOutput output
  }
  class ToolResultOutput {
    <<sealed union>>
    +string type
    +unknown|string value
  }
  class TROjson {
    +"json" type
    +unknown value
  }
  class TROtext {
    +"text" type
    +string value
  }
  class TROerrorText {
    +"error-text" type
    +string value
  }
  class TROerrorJson {
    +"error-json" type
    +unknown value
  }
  class TROcontent {
    +"content" type
    +Array~ContentItem~ value
  }
  ToolResultOutput <|-- TROjson
  ToolResultOutput <|-- TROtext
  ToolResultOutput <|-- TROerrorText
  ToolResultOutput <|-- TROerrorJson
  ToolResultOutput <|-- TROcontent
  ContentPart <|-- TextPart
  ContentPart <|-- ReasoningPart
  ContentPart <|-- ToolCallPart
  ContentPart <|-- ToolResultPart
  ToolResultPart *-- "1" ToolResultOutput : output
  StoredMessage --> Role : role
  StoredMessage *-- "0..*" ContentPart : content
```

```ts
type ToolResultOutput =
  | { type: 'json';        value: unknown }
  | { type: 'text';        value: string }
  | { type: 'error-text';  value: string }
  | { type: 'error-json';  value: unknown }
  | { type: 'content';     value: Array<
      | { type: 'text'; text: string }
      | { type: 'media'; data: string; mediaType: string }
    > };

type ContentPart =
  | { type: 'text';        text: string }
  | { type: 'reasoning';   text: string }
  | { type: 'tool-call';   toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: ToolResultOutput };

type StoredMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];   // user messages may be plain string
};
```

`isError` is **not** stored on `ToolResultPart` — it's derived at translate time as `output.type.startsWith('error-')`. The wire format (§3.2.1) keeps `isError` for UI convenience; the bridge lives in `agent/translate.ts`.

Why JSON-blob over a relational `content_parts` table:
- Round-trip back into `streamText({ messages })` is lossless and trivial.
- One read = one row per message; no N+1 reassembly.
- Ordering within a message is preserved by array index.
- The cost of giving up SQL queries against part contents is negligible — we never need to query *into* a single message's parts.

---

## 3. APIs

All routes are JSON in / JSON out except `POST /api/chat`, which streams Server-Sent Events (or NDJSON / WS — see §4 alternatives).

### 3.1 Endpoint catalog

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat` | Send a user message; receive a streamed agent response |
| `GET` | `/api/conversations` | List conversations (id, title, updated_at) |
| `GET` | `/api/conversations/:id` | Load full conversation with messages and usage |
| `POST` | `/api/conversations` | Create empty conversation (returns `id`) |
| `DELETE` | `/api/conversations/:id` | Delete conversation + cascade |
| `DELETE` | `/api/messages/:id` | Delete one user message + cascade through the rest of the turn (see §3.3); re-number `position` |
| `GET` | `/api/usage/:conversationId` | Aggregate usage for a conversation |
| `GET` | `/health` | Liveness/readiness probe |

### 3.2 `POST /api/chat`

**Request body**
```json
{
  "conversationId": "01J9X...ULID",                  // optional; absent → server creates one (FR-14)
  "message": "What's the dosage range for ibuprofen?",
  "model": "anthropic/claude-sonnet-4.6"             // optional override; OpenRouter id
}
```

`conversationId` is `?: string` (undefined when absent). Zod schema rejects `null`.

**Response**: `Content-Type: text/event-stream` (or NDJSON; see §4). Stream of typed events.

#### 3.2.1 SSE event taxonomy (mapped from AI SDK `fullStream` parts)

Wire events on the left, AI SDK part type that produces them on the right.

| `event:` | `data:` payload | Sourced from AI SDK part |
| --- | --- | --- |
| `start` | `{ messageId, userMessageId, conversationId, model }` — `userMessageId` is the just-persisted user message id, surfaced so the client can address it later (e.g. for DELETE) | server-emitted after persisting the user message |
| `text-delta` | `{ delta: string }` | `text-delta` |
| `reasoning-start` | `{}` | `reasoning-start` |
| `reasoning-delta` | `{ delta: string }` | `reasoning-delta` |
| `reasoning-end` | `{}` | `reasoning-end` |
| `tool-call-start` | `{ id, name }` | `tool-input-start` |
| `tool-call-delta` | `{ id, partialInput: string }` | `tool-input-delta` |
| `tool-call-end` | `{ id, input: object }` | `tool-call` |
| `tool-call-result` | `{ id, output: unknown, isError: boolean, durationMs }` — `output` is the AI SDK `ToolResultOutput.value`; `isError` is derived from `output.type.startsWith('error-')` (§2.4) | `tool-result` |
| `step` | `{ index, reason: 'tool' \| 'final' \| 'capped' }` — happy-path only; abnormal `finishReason`s route to `error` (see mapping below) | `step-finish` with happy `finishReason` |
| `metadata` | `{ messageId, model, inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, latencyMs, costUsd }` — terminal happy-path event; client treats stream-close-after-`metadata` as "done" | `finish` (final usage) |
| `error` | `{ code, message }` — terminal; errors are not recoverable from the client's perspective in Phase 1 | `error` part OR caught exception |

**`finishReason` → wire-event mapping** (Step 0.6):

| AI SDK `finishReason` | Wire event | Notes |
| --- | --- | --- |
| `stop` | `step { reason: 'final' }` | model produced a final answer |
| `tool-calls` | `step { reason: 'tool' }` | model requested tools; loop continues |
| (server-side cap hit) | `step { reason: 'capped' }` | `stopWhen: stepCountIs(N)` triggered |
| `length` | `error { code: 'UPSTREAM_TRUNCATED' }` | model hit max tokens |
| `content-filter` | `error { code: 'CONTENT_FILTERED' }` | provider safety filter blocked output |
| `error` | `error { code: 'UPSTREAM_ERROR' }` | provider-side error during step |
| `other` / unknown | `error { code: 'UPSTREAM_ERROR' }` | defensive default |

Wire format example:
```
event: start
data: {"messageId":"01J...","userMessageId":"01J...","conversationId":"01J...","model":"anthropic/claude-sonnet-4.6"}

event: text-delta
data: {"delta":"Ibuprofen"}

event: tool-call-start
data: {"id":"toolu_abc","name":"drug_info"}

...
event: metadata
data: {"messageId":"01J...","model":"anthropic/claude-sonnet-4.6","inputTokens":12,"outputTokens":8,"cacheReadTokens":0,"cacheCreateTokens":0,"latencyMs":842,"costUsd":0.0001}
```

There is no `done` event — `metadata` followed by stream close is the terminal happy-path signal.

### 3.3 Other endpoints (concise)

- `GET /api/conversations/:id` → `{ id, title, createdAt, updatedAt, messages: [{ id, role, content, position, createdAt, usage? }] }`. 404 if not found.
- `DELETE /api/messages/:id` — accepts **only user-message ids**; cascade-deletes the user message plus every subsequent assistant/tool message until the next user message (or end of conversation), then re-numbers `position` atomically inside a transaction (two-pass shift, see §2.2). Returns:
  - `204` on success
  - `400 INVALID_TARGET` if the id resolves to an `assistant` or `tool` row (use case: client must delete a whole exchange, not just the response)
  - `404 NOT_FOUND` if the id does not exist

  Rationale: keeping NFR-8 (no orphan `tool_use` without `tool_result`) holds trivially when an entire turn is the unit of deletion.
- `GET /api/usage/:conversationId` → `{ totals: { inputTokens, outputTokens, costUsd }, perMessage: [...] }`.
- `GET /health` → `{ status: 'ok', migrations: 'applied', db: 'reachable' }`. Returns 503 if DB unreachable or migrations pending.

### 3.4 Error envelope (non-stream)

```json
{ "error": { "code": "INVALID_INPUT", "message": "message must be a non-empty string", "details": [ ... ] } }
```

Codes used: `INVALID_INPUT`, `INVALID_TARGET`, `NOT_FOUND`, `UPSTREAM_TIMEOUT`, `UPSTREAM_TRUNCATED`, `CONTENT_FILTERED`, `UPSTREAM_ERROR`, `INTERNAL`, `RATE_LIMITED`.

> `RATE_LIMITED` is **reserved** for propagating upstream provider 429s (e.g. OpenRouter throttling). Phase 1 does not rate-limit the API itself — see §1.3.

---

## 4. Architecture — Final

### 4.1 Stack at a glance

| Layer | Pick |
| --- | --- |
| Runtime | **Bun 1.x** + TypeScript |
| HTTP framework | **Hono** (`streamSSE` helper) |
| LLM SDK | **Vercel AI SDK** (`ai`) |
| Provider | **OpenRouter** (`@openrouter/ai-sdk-provider`) |
| Default model | `anthropic/claude-sonnet-4.6` (swappable via `OPENROUTER_MODEL` env) |
| Persistence | **SQLite** (`bun:sqlite`) + **Drizzle ORM** + `drizzle-kit` migrations |
| Validation | **Zod** |
| IDs | **ULID** |
| Wire format | **SSE** (`text/event-stream`) over POST — taxonomy in §3.2.1 |
| Storage shape | **JSON content-parts blob** per message row (§2.4) |
| Logger | `pino` (single line per request) |
| Test runner | `bun test` |

### 4.2 Package list

```jsonc
// backend/package.json (relevant deps)
{
  "dependencies": {
    "ai": "^5",
    "@openrouter/ai-sdk-provider": "^1",
    "hono": "^4",
    "drizzle-orm": "^0.44",
    "zod": "^3",
    "ulid": "^2",
    "pino": "^9"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31",
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

No native build deps; entire image runs on `oven/bun:1-alpine`.

### 4.3 Component diagram

```mermaid
flowchart TB
  subgraph Backend["backend (single Bun process)"]
    direction TB
    Req([HTTP request]) --> MW[Middleware<br/>cors · zValidator · requestId · pino · errorHandler]
    MW --> Routes
    subgraph Routes
      RChat["POST /api/chat (SSE)"]
      RConv["/api/conversations/*"]
      RMsg["DELETE /api/messages/:id"]
      RUsg["GET /api/usage/:conversationId"]
      RHealth["GET /health"]
    end
    RChat --> Agent
    RConv --> Repos
    RMsg --> Repos
    RUsg --> Repos
    RHealth --> SQLite

    subgraph Agent["AgentService"]
      direction TB
      LoadHist["load history"]
      StreamText["streamText (AI SDK)<br/>tools · stopWhen · abortSignal"]
      Translate["translate fullStream → SSE"]
      Persist["persist messages + usage"]
      LoadHist --> StreamText --> Translate --> Persist
    end

    subgraph Tools["ToolRegistry"]
      DrugInfo["drug_info"]
      SymLookup["symptom_lookup"]
    end

    subgraph Repos["Repositories"]
      RConvs[conversations]
      RMsgs[messages]
      RUsage[usage]
    end

    StreamText --> Tools
    Persist --> Repos
    LoadHist --> Repos
    Repos --> SQLite[(SQLite via Drizzle)]
    DrugInfo -. HTTP .-> ExtFDA[(openFDA)]
    SymLookup --> SymJSON[(symptoms.json)]
    StreamText -. HTTPS .-> OpenRouter[("OpenRouter →<br/>Claude / GPT / Gemini")]
  end
```

### 4.4 Sequence — `POST /api/chat`

```mermaid
sequenceDiagram
  autonumber
  actor Client
  participant Hono as Hono route
  participant Agent as AgentService
  participant SDK as AI SDK
  participant OR as OpenRouter
  participant Tool as Tool
  participant DB as SQLite

  Client->>Hono: POST /api/chat
  Hono->>Hono: zod validate body
  Hono->>DB: load history
  DB-->>Hono: messages[]
  Hono->>Agent: streamSSE(translate(fullStream))
  Hono-->>Client: event: start
  Agent->>SDK: streamText({messages, tools, stopWhen, abortSignal})
  SDK->>OR: HTTP stream

  loop while not finished and steps < cap
    OR-->>SDK: reasoning-delta
    SDK-->>Agent: part
    Agent-->>Client: event: reasoning-*
    OR-->>SDK: text-delta
    SDK-->>Agent: part
    Agent-->>Client: event: text-delta
    alt tool requested
      OR-->>SDK: tool-call (input streaming)
      SDK-->>Agent: tool-input-* parts
      Agent-->>Client: event: tool-call-start / -delta / -end
      SDK->>Tool: execute(input)
      Tool-->>SDK: result
      SDK-->>Agent: tool-result part
      Agent-->>Client: event: tool-call-result
      SDK->>OR: continue with tool result
    end
  end

  OR-->>SDK: finish (usage)
  SDK-->>Agent: finish part
  Agent->>DB: persist assistant message + usage
  Agent-->>Client: event: metadata
  Agent-->>Client: event: done
```

### 4.5 Folder layout (Phase 1 scope only)

```
backend/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── src/
│   ├── index.ts                  # Hono app entry + middleware + route mounts
│   ├── env.ts                    # zod-validated env loader, fail-fast on boot
│   ├── db/
│   │   ├── client.ts             # Drizzle + bun:sqlite, single-instance
│   │   ├── schema.ts             # conversations / messages / usage tables
│   │   ├── repos/
│   │   │   ├── conversations.ts
│   │   │   ├── messages.ts
│   │   │   └── usage.ts
│   │   └── migrations/           # generated by drizzle-kit
│   ├── agent/
│   │   ├── service.ts            # runAgent({ conversationId, message, sse })
│   │   ├── translate.ts          # AI SDK fullStream part → our SSE event
│   │   ├── tools/
│   │   │   ├── index.ts          # registry shape consumed by streamText
│   │   │   ├── drug_info.ts      # openFDA fetch + zod input/output
│   │   │   └── symptom_lookup.ts # seeded lookup + disclaimer
│   │   └── data/symptoms.json
│   ├── routes/
│   │   ├── chat.ts               # POST /api/chat (SSE)
│   │   ├── conversations.ts      # GET /, GET /:id, POST /, DELETE /:id
│   │   ├── messages.ts           # DELETE /:id
│   │   ├── usage.ts              # GET /:conversationId
│   │   └── health.ts
│   ├── lib/
│   │   ├── sse.ts                # tiny encoder used by translate.ts
│   │   ├── pricing.ts            # token → USD per model id
│   │   ├── errors.ts             # httpError + toErrorEvent
│   │   ├── ids.ts                # ulid()
│   │   └── logger.ts             # pino instance
│   └── lib/validate.ts           # zod schemas reused by routes + tools
└── tests/
    ├── pricing.test.ts
    ├── tools.test.ts
    ├── translate.test.ts
    ├── repos.test.ts
    └── routes/
        ├── chat.test.ts
        ├── conversations.test.ts
        └── health.test.ts
```

### 4.6 Required environment variables (Phase 1 subset)

These get codified in `.env.example` in Phase 4; listed here so the spec is self-contained.

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | ✅ secret | — | Single key for any OpenRouter-routed model |
| `OPENROUTER_MODEL` | optional | `anthropic/claude-sonnet-4.6` | Provider-agnostic name; OpenRouter model id (e.g. `anthropic/claude-sonnet-4.6`, `openai/gpt-5`, `google/gemini-2.5-pro`). Validated at boot via `pricing.assertKnown` (F-13, Step 0.5 #6). |
| `MAX_AGENT_STEPS` | optional | `8` | Feeds `stopWhen: stepCountIs(N)` |
| `AI_TIMEOUT_MS` | optional | `60000` | Whole-stream budget; feeds `AbortSignal.timeout(ms)` for `streamText` |
| `TOOL_TIMEOUT_MS` | optional | `5000` | **Independent** of `AI_TIMEOUT_MS`; per-tool budget enforced inside each tool's `execute` (F-4) |
| `DATABASE_PATH` | optional | `./data/app.db` | Plain filesystem path consumed by `bun:sqlite` (no `file:` prefix). In container, `/data/app.db`. |
| `PORT` | optional | `8787` | |
| `LOG_LEVEL` | optional | `info` | pino level |

### 4.7 Internal interface contracts

```ts
// agent/service.ts
type RunAgentArgs = {
  conversationId?: string          // undefined → server creates one (FR-14)
  message: string
  modelOverride?: string
  abortSignal?: AbortSignal
}
type RunAgentResult = AsyncIterable<SSEEvent>   // yielded for the route to write

// agent/translate.ts
function translate(part: AISDKStreamPart, ctx: TranslateCtx): SSEEvent | null
// returns null for parts we intentionally don't surface (e.g. step-start).
// Mid-stream exceptions (provider throws while iterating fullStream) are NOT
// returned here — the caller wraps the for-await loop in a try/catch and emits
// an error event. See §4.B for the rationale.

// db/repos/messages.ts
type AppendMessageInput = {
  conversationId: string
  role: 'user' | 'assistant' | 'tool'
  content: ContentPart[] | string
}
function append(input: AppendMessageInput): Promise<{ id: string; position: number }>
function deleteAndRenumber(id: string): Promise<void>
function deleteUserTurn(userMessageId: string): Promise<void>   // §3.3 cascade delete
```

### 4.8 Stream lifecycle — exception handling

The `start` event is emitted **after** persisting the user message but **before** invoking `streamText`. If `streamText` throws synchronously (bad model id, missing key) or asynchronously while iterating `result.fullStream` (provider mid-stream error, network drop), control returns to the route handler with the SSE stream already open. The route's `streamSSE` callback wraps the entire iteration **plus the `streamText` call** in a try/catch:

```ts
streamSSE(c, async stream => {
  let userMsgId: string | undefined
  try {
    userMsgId = await persistUserMessage(...)
    await stream.writeSSE(encode('start', { messageId, userMessageId: userMsgId, ... }))
    const result = streamText({ ... })
    for await (const part of result.fullStream) {
      const ev = translate(part, ctx)
      if (ev) await stream.writeSSE(encode(ev.event, ev.data))
    }
    await persistAssistantMessages(ctx)
    await stream.writeSSE(encode('metadata', { ... }))
  } catch (err) {
    await persistPartial(ctx)                    // F-12: never persist orphan tool_use
    await stream.writeSSE(encode('error', toErrorEvent(err)))
  }
  // stream auto-closes
})
```

This guarantees:
- A client that has received `start` always also receives a terminal `metadata` **or** `error` before the stream closes.
- F-1 (provider error mid-stream), F-2 (timeout), F-11 (client disconnect — surfaces as an `AbortError`) all funnel through the same catch.
- F-12 (atomic persistence): the `persistPartial` path never writes a half-built `content` array — it persists the assistant row with `content: []` if no complete part was emitted, or with the complete-only prefix otherwise.

---

## 5. Data Flow (high-level narrative)

The diagrams in §4.3–§4.4 are the authoritative, technology-specific views. The diagrams in this section are the same flow at one level of abstraction higher, useful for talking about the system without the specific tech labels.

### 5.1 Happy-path sequence (abstract)

```mermaid
sequenceDiagram
  actor Client
  participant Server
  participant LLM as LLM provider
  participant Tool
  participant Store

  Client->>Server: POST /api/chat
  Server->>Store: load history, upsert conversation, append user message
  Server-->>Client: event: start
  Server->>LLM: stream(history)
  LLM-->>Server: reasoning + text deltas
  Server-->>Client: reasoning / text events
  LLM-->>Server: tool call request
  Server-->>Client: tool-call-start / -delta
  Server->>Tool: execute(input)
  Tool-->>Server: result
  Server-->>Client: tool-call-result
  Server->>LLM: stream(history + tool result)
  LLM-->>Server: text deltas + finish (usage)
  Server-->>Client: text events
  Server->>Store: append assistant message + usage
  Server-->>Client: metadata
  Server-->>Client: done
```

### 5.2 Component diagram (logical, transport-agnostic)

```mermaid
flowchart TB
  subgraph Process["Backend Process"]
    direction TB
    HTTP([HTTP]) --> Router
    Router --> ChatRoute
    ChatRoute --> Validator
    ChatRoute --> AgentLoop
    AgentLoop --> ToolRegistry
    AgentLoop --> StreamEncoder
    AgentLoop --> PersistenceRepo
    ToolRegistry --> DrugInfo[drug_info]
    ToolRegistry --> SymLookup[symptom_lookup]
    DrugInfo --> ExtFDA[(openFDA)]
    SymLookup --> SeedJSON[(seeded JSON)]
    PersistenceRepo --> Store[(SQLite)]
    Router -.- ErrorMW[Error middleware]
    Router -.- Logger
  end
```

---

## 6. Test Cases

Tests live in `backend/tests/`. Bun's built-in test runner (`bun test`).

### 6.1 Unit

| ID | Subject | Assertion |
| --- | --- | --- |
| U-1 | `pricing.calculate` | Known token counts → expected USD per model |
| U-2 | `validate.chatRequest` | Empty `message` rejected; oversize `message` rejected; valid passes |
| U-3 | `tools/drug_info` | Mocked openFDA 200 → normalized `{name, indications, warnings, dosage}`; 404 → structured tool error |
| U-4 | `tools/symptom_lookup` | Exact match; fuzzy match; unknown symptom → `{ found: false, disclaimer }` |
| U-5 | `db/messages.append` | Message row inserted with monotonically increasing `position` |
| U-6 | `db/messages.delete` | Deleting a middle message renumbers later positions; cascade preserves `usage` link |
| U-7 | `streamEncoder.encode` | Each event type produces correct `event:`/`data:` framing |

### 6.2 Integration (route-level, in-process)

| ID | Subject | Assertion |
| --- | --- | --- |
| I-1 | `POST /api/chat` happy path with mocked provider | Stream contains `start` → `text-delta`+ → `metadata` → `done`; messages persisted |
| I-2 | `POST /api/chat` with one tool call (mocked provider) | Stream contains `tool-call-start`/`-delta`/`-end`/`-result`; second model call observed; final text emitted |
| I-3 | `POST /api/chat` hits step cap | Stream ends with `step{reason:'capped'}` then `done`; assistant message persisted |
| I-4 | `POST /api/chat` with invalid body | 400 with `INVALID_INPUT` envelope; no DB writes |
| I-5 | `GET /api/conversations/:id` after I-1 | Returns user + assistant messages with correct `content` blocks and `usage` |
| I-6 | `DELETE /api/messages/:id` | 204; subsequent GET shows renumbered positions |
| I-7 | `GET /health` | 200 once migrations applied; 503 if DB unreachable (simulated) |
| I-8 | `POST /api/chat` provider timeout (mock delays past `AI_TIMEOUT_MS`) | Stream emits `error{code:'UPSTREAM_TIMEOUT'}` then closes; partial assistant message persisted |
| I-9 | `POST /api/chat` provider error mid-stream | `error` event with `recoverable:false`; no orphan tool_use without tool_result |

### 6.3 Contract / smoke

| ID | Subject | Assertion |
| --- | --- | --- |
| C-1 | SSE event names match the §3.2.1 catalog exactly (regex over fixture) | snapshot test |
| C-2 | Loaded history → provider message shape is accepted by SDK type | typecheck-only test |
| C-3 | **Runtime** round-trip: persist a multi-step conversation via repos → `loadHistory(id)` → pass to `streamText({ messages, model: mockModel })` → assert no provider-side validation error and `mockModel.callCounter > 0` | runtime test against `MockLanguageModelV2` |

---

## 7. Failure Modes

| ID | Trigger | Symptom | Mitigation | Test that proves it |
| --- | --- | --- | --- | --- |
| F-1 | Provider 5xx mid-stream | Stream cuts | Outer try/catch around the `for await fullStream` (§4.8) emits `error { code: 'UPSTREAM_ERROR' }`, persists partial assistant content, closes stream | I-9 |
| F-2 | Provider timeout (no first token within `AI_TIMEOUT_MS`) | Hung request | `AbortSignal.timeout(AI_TIMEOUT_MS)` passed to `streamText`; abort propagates through fullStream → caught by §4.8 wrapper → `UPSTREAM_TIMEOUT` | I-8 |
| F-3 | Tool execute throws | Loop dies | AI SDK's `tool()` wrapper catches and emits `tool-result { output: { type: 'error-text', value } }`; agent loop continues | unit U-3, integration I-2e |
| F-4 | Tool times out (`TOOL_TIMEOUT_MS`) | Hung loop | Each tool's `execute` uses `AbortSignal.timeout(TOOL_TIMEOUT_MS)`; same error-result path as F-3 | U-3 (timeout case) |
| F-5 | Step cap reached | Infinite loop risk avoided | `stopWhen: stepCountIs(MAX_AGENT_STEPS)`; emit `step{reason:'capped'}` then `metadata` | I-3 |
| F-6 | Malformed input body | 500 if unhandled | Zod validation at route entry → 400 `INVALID_INPUT` | U-2, I-4 |
| F-7 | DB failure (disk full / locked / corrupted) | Various | (a) **Pre-stream** (history load): respond 500 `INTERNAL` before opening SSE; (b) **mid/post-stream** (insert): caught by §4.8 wrapper → `error { code: 'INTERNAL' }`, log, do not crash | I-7 (read fail), manual chaos for write |
| F-8 | Provider returns malformed `tool-input` JSON | `JSON.parse` throws | AI SDK's `tool-input-end` part includes parsed object; on parse failure the SDK emits `tool-result { type: 'error-json' }` automatically | translate.test.ts |
| F-9 | Concurrent identical message id (race) | UNIQUE constraint violation | Server generates ULIDs; ignore client-provided ids | U-5 |
| F-10 | `conversationId` provided but unknown | 404 (per FR-14) | Repo lookup before opening SSE; 404 `NOT_FOUND` envelope | I-5 (negative variant) |
| F-11 | Client disconnects mid-stream | We keep generating, wasting tokens | Hono's `c.req.raw.signal` is wired into `streamText({ abortSignal })`; surfaces as `AbortError` → caught by §4.8 wrapper → persist partial, log `client_aborted` | I-11 |
| F-12 | Process crash mid-write | Partial assistant message persisted | Build `content: ContentPart[]` in memory; single insert at end. On error path, persist `[]` rather than half-built; never persist orphan `tool-call` without matching `tool-result` | I-9 |
| F-13 | `OPENROUTER_API_KEY` missing or `OPENROUTER_MODEL` unknown | Crash on first request | **Fail fast at boot:** Zod env validation + `pricing.assertKnown(OPENROUTER_MODEL)` run before the server binds. `/health` is unreachable until env is correct (no "ok:false" middle ground). | startup test |
| F-14 | Tool input doesn't match Zod `inputSchema` | Tool execute called with bad shape | AI SDK's `tool({ inputSchema })` validates and surfaces `tool-result { output: { type: 'error-json', value: <zod issues> } }` automatically; agent loop continues | unit `tools/input-validation.test.ts` |
| F-15 | Concurrent SQLite writes contend for the lock | `SQLITE_BUSY` / `LOCKED` errors | At startup in `db/client.ts`: `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL`. WAL allows concurrent reads with one writer; required for I-10's concurrency test. | `db/client.test.ts` (PRAGMA assertion), I-10 |

---

## 8. Sign-off

All architecture axes resolved (§4). This spec is the contract for Phase 1 implementation; subsequent phases reference it.

| Axis | Decision |
| --- | --- |
| Stream transport | A1 — SSE over POST, hand-parsed client |
| Agent loop | B2a — Vercel AI SDK `streamText` + `@openrouter/ai-sdk-provider` |
| HTTP framework | C1 — Hono |
| Persistence | D1 — SQLite (`bun:sqlite`) + Drizzle ORM |
| Storage shape | E1 — JSON content-parts blob per message row |
| Validation | F1 — Zod |
| IDs | G1 — ULID |
