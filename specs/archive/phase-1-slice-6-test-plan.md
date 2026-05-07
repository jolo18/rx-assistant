# Slice 6 Test Plan — `AgentService` + `POST /api/chat`

> **Why this doc exists:** Slice 6 is where Phase 1's application logic concentrates. The mock-LLM part scripts below *are* the behavior spec for the agent loop, expressed as inputs. They get designed once, in detail, before any code is written. Slices 1–5 and 7–8 use just-in-time test design at the start of each slice.
>
> **Reads:**
> - `specs/phase-1-agentic-streaming-backend.md` §3.2.1 (SSE wire taxonomy), §4.4 (sequence), §4.7 (interface contracts), §6 (test inventory), §7 (failure modes)
> - Plan: `~/.claude/plans/read-the-assignement-file-ethereal-fog.md` Slice 6

## Scope

8 integration tests covering the chat endpoint end-to-end with mocked LLM and stubbed tools. All tests live in `backend/tests/routes/chat.test.ts`.

| Test id | Name | Spec ids |
| --- | --- | --- |
| **I-1** | Happy path — text-only response | FR-1, FR-2, FR-3, FR-7, FR-8, FR-9, FR-14, NFR-1 |
| **I-1r** | Reasoning streamed before text | FR-3 |
| **I-2** | Single tool call — full roundtrip | FR-4, FR-5, FR-6, I-2 |
| **I-2e** | Tool execution error → loop continues | F-3 |
| **I-3** | Step cap reached | FR-6, F-5, I-3 |
| **I-4** | Invalid body → 400 INVALID_INPUT | FR-11, FR-12, F-6, I-4 |
| **I-8** | Provider timeout → UPSTREAM_TIMEOUT | NFR-2, F-2, I-8 |
| **I-9** | Provider error mid-stream | F-1, F-12, I-9 |
| **I-10** | 10 concurrent streams complete cleanly | NFR-7, F-15 |
| **I-11** | Client disconnect aborts upstream | F-11, NFR-3 |

---

## Shared Test Infrastructure

These three helpers live in `backend/tests/_helpers/` and are shared by every test in the suite. Designing them upfront means each individual test stays a few lines.

### `scriptModel(...calls)` — Mock LLM helper

Wraps `MockLanguageModelV2` from `ai/test`. Accepts an array of "calls" — each call is the array of `LanguageModelV2StreamPart` objects that `doStream` returns for that invocation. The mock advances its call index automatically across reinvocations.

```ts
import { MockLanguageModelV2 } from 'ai/test'
import type { LanguageModelV2StreamPart } from '@ai-sdk/provider'

export function scriptModel(...calls: LanguageModelV2StreamPart[][]) {
  let i = 0
  const callCounter = { count: 0 }
  const model = new MockLanguageModelV2({
    doStream: async () => {
      callCounter.count++
      const parts = calls[i++ % calls.length]
      return {
        stream: simulateReadableStream({ chunks: parts }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }
    },
  })
  return { model, callCounter }
}
```

`simulateReadableStream` from `ai/test` turns an array into a `ReadableStream` of typed parts, with optional inter-chunk delays for timing tests.

### `buildApp(overrides?)` — Test app factory

Returns a Hono `app` (and the underlying SQLite db, mock model, tool spies) wired identically to production but with:
- in-memory SQLite (`new Database(':memory:')`) with migrations applied
- mocked LLM (the one returned by `scriptModel(...)`)
- stubbed tools whose `execute` is a `mock.fn()` returning a configurable result

```ts
type Overrides = {
  model: LanguageModelV2
  tools?: Partial<typeof realTools>
  env?: Partial<Env>   // e.g. { MAX_AGENT_STEPS: 2, AI_TIMEOUT_MS: 50 }
}
export function buildApp(o: Overrides): {
  app: Hono
  db: ReturnType<typeof drizzleFromSqlite>
  toolSpies: { drug_info: Mock, symptom_lookup: Mock }
}
```

### `collectSSE(response)` — Wire-format reader

Reads a streaming `Response`, parses each `event:` / `data:` frame, and returns an ordered array of parsed events. Tests assert against this array.

```ts
type SSEFrame = { event: string; data: unknown }
export async function collectSSE(res: Response): Promise<SSEFrame[]>
```

---

## Test Cases

For each test: **Arrange · Act · Assert**. `app`, `db`, `toolSpies`, `model`, `callCounter` come from `buildApp` / `scriptModel`.

### I-1 — Happy path: text-only response

**Arrange**

```ts
const { model, callCounter } = scriptModel([
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Ibu' },
  { type: 'text-delta', id: 't1', delta: 'profen' },
  { type: 'text-delta', id: 't1', delta: ' is an NSAID.' },
  { type: 'text-end',   id: 't1' },
  { type: 'finish', finishReason: 'stop',
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } },
])
const { app, db } = buildApp({ model })
```

**Act**

```ts
const res = await app.request('/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'What is ibuprofen?' }),
})
const events = await collectSSE(res)
```

**Assert — wire**
- `res.status === 200`
- `res.headers.get('content-type')` starts with `text/event-stream`
- `res.headers.get('x-request-id')` is a non-empty string
- `events.map(e => e.event)` is exactly:
  `['start', 'text-delta', 'text-delta', 'text-delta', 'metadata']`
  (no `done` — Step 0.6; `metadata` is the terminal happy-path event)
- `events[0].data` matches `{ messageId: ulidLike, userMessageId: ulidLike, conversationId: ulidLike, model: 'anthropic/claude-sonnet-4.6' }`
- `events[1..3].data.delta` ⇒ `['Ibu', 'profen', ' is an NSAID.']`
- `events[4].data` matches `{ messageId, model, inputTokens: 12, outputTokens: 8, cacheReadTokens: 0, cacheCreateTokens: 0, latencyMs: > 0, costUsd: > 0 }`

**Assert — DB**
- One row in `conversations`
- Two rows in `messages` for that conversation
  - position 0: role `user`, content `[{ type: 'text', text: 'What is ibuprofen?' }]` (or matching string per spec §2.4)
  - position 1: role `assistant`, content `[{ type: 'text', text: 'Ibuprofen is an NSAID.' }]`
- One row in `usage` linked to the assistant message: `input_tokens=12`, `output_tokens=8`, `latency_ms > 0`, `cost_usd > 0`, `model='anthropic/claude-sonnet-4.6'`

**Assert — mock**
- `callCounter.count === 1`
- No tool spies invoked

---

### I-1r — Reasoning streamed before text

**Arrange**

```ts
const { model } = scriptModel([
  { type: 'reasoning-start', id: 'r1' },
  { type: 'reasoning-delta', id: 'r1', delta: 'I should ' },
  { type: 'reasoning-delta', id: 'r1', delta: 'mention NSAID.' },
  { type: 'reasoning-end',   id: 'r1' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Ibuprofen is an NSAID.' },
  { type: 'text-end',   id: 't1' },
  { type: 'finish', finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 6 } },
])
const { app } = buildApp({ model })
```

**Act**: same as I-1.

**Assert — wire (event order)**

```
['start',
 'reasoning-start',
 'reasoning-delta', 'reasoning-delta',
 'reasoning-end',
 'text-delta',
 'metadata']
```

Concatenated `reasoning-delta` deltas equal `'I should mention NSAID.'`.

**Assert — DB**
- Assistant `messages.content` array contains `{ type: 'reasoning', text: 'I should mention NSAID.' }` followed by `{ type: 'text', text: 'Ibuprofen is an NSAID.' }`. Reasoning is preserved on reload (proves §2.4 round-trip works for reasoning parts).

---

### I-2 — Single tool call, full roundtrip

**Arrange**

```ts
const { model, callCounter } = scriptModel(
  // Call 1 — model requests a tool call
  [
    { type: 'tool-input-start', id: 'tu1', toolName: 'drug_info' },
    { type: 'tool-input-delta', id: 'tu1', delta: '{"qu' },
    { type: 'tool-input-delta', id: 'tu1', delta: 'ery":"ibuprofen"}' },
    { type: 'tool-input-end',   id: 'tu1' },
    { type: 'tool-call', toolCallId: 'tu1', toolName: 'drug_info',
      input: { query: 'ibuprofen' } },
    { type: 'finish', finishReason: 'tool-calls',
      usage: { inputTokens: 50, outputTokens: 20 } },
  ],
  // Call 2 — after tool result is fed back, model produces final text
  [
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'Ibuprofen treats pain.' },
    { type: 'text-end',   id: 't1' },
    { type: 'finish', finishReason: 'stop',
      usage: { inputTokens: 80, outputTokens: 10 } },
  ],
)
const { app, db, toolSpies } = buildApp({
  model,
  tools: {
    drug_info: stubTool({
      output: { name: 'ibuprofen', indications: 'pain',
                warnings: 'kidneys', dosage: '200-400mg' }
    })
  },
})
```

**Act**: POST `{ message: 'What is ibuprofen?' }`.

**Assert — wire (event types in order)**

```
['start',
 'tool-call-start',                    // {id:'tu1', name:'drug_info'}
 'tool-call-delta', 'tool-call-delta', // partialInput strings
 'tool-call-end',                      // {id:'tu1', input:{query:'ibuprofen'}}
 'tool-call-result',                   // {id:'tu1', output:<value>, isError:false, durationMs>0}
 'step',                               // {index:1, reason:'tool'}
 'text-delta',
 'step',                               // {index:2, reason:'final'}
 'metadata']                           // summed usage: in 130, out 30; terminal event
```

`tool-call-end.input` deep-equals `{ query: 'ibuprofen' }`. `tool-call-result.output` deep-equals the stubbed return value (the `value` field of the AI SDK `ToolResultOutput`); `tool-call-result.isError === false`.

**Assert — mock**
- `callCounter.count === 2` (two model invocations)
- `toolSpies.drug_info` called exactly once with `{ query: 'ibuprofen' }`
- `toolSpies.symptom_lookup` not called

**Assert — DB** *(role-as-own-row policy from Step 0.5 #1: tool-result lives in its own message with role `'tool'`)*
- Conversation has **4 messages**:
  - pos 0, role `user`: content matches the input
  - pos 1, role `assistant`: content `[{ type: 'tool-call', toolCallId: 'tu1', toolName: 'drug_info', input: { query: 'ibuprofen' } }]`
  - pos 2, role `tool`: content `[{ type: 'tool-result', toolCallId: 'tu1', toolName: 'drug_info', output: { type: 'json', value: <stub_return> } }]`
  - pos 3, role `assistant`: content `[{ type: 'text', text: 'Ibuprofen treats pain.' }]`
- **One** `usage` row linked to the **pos-3** assistant message: `input_tokens=130`, `output_tokens=30` (summed across both calls).
- `SELECT COUNT(*) FROM usage WHERE message_id IN (<all assistant ids>) === 1` (Step 0.5 #4 — usage is one-row-per-turn, not per-step).
- History reload (`loadHistory(conversationId)`) returns a sequence assignable to AI SDK `ModelMessage[]` (typecheck-only).

---

### I-2e — Tool execution error handled gracefully

**Arrange**

Same as I-2, but `drug_info.execute` throws:

```ts
const { app, toolSpies } = buildApp({
  model,
  tools: {
    drug_info: stubTool({ throws: new Error('openFDA 503') })
  },
})
```

Mock LLM call 2 stays the same — the model produces a text answer despite the failed tool.

**Assert — wire**

`tool-call-result` event has `{ id: 'tu1', output: <error value>, isError: true, durationMs > 0 }`. (`isError` is derived from `output.type === 'error-text'` or `'error-json'` per Step 0.5 #2.) The loop continues — `text-delta` and a final `metadata` follow.

**Assert — DB**

Same 4-row structure as I-2, but the pos-2 tool message's content is:
`[{ type: 'tool-result', toolCallId: 'tu1', toolName: 'drug_info', output: { type: 'error-text', value: 'openFDA 503' } }]`

No process crash; subsequent `GET /health` returns 200 (proves NFR-4 / F-7 indirectly).

**Spec ids covered:** F-3.

---

### I-3 — Step cap reached

**Arrange**

```ts
const toolPartsCall = [
  { type: 'tool-input-start', id: () => `tu_${i++}`, toolName: 'drug_info' },
  { type: 'tool-input-end',   id: () => `tu_${i++}` },
  { type: 'tool-call', toolCallId: () => `tu_${i++}`, toolName: 'drug_info',
    input: { query: 'x' } },
  { type: 'finish', finishReason: 'tool-calls',
    usage: { inputTokens: 30, outputTokens: 10 } },
]
const { model, callCounter } = scriptModel(
  toolPartsCall, toolPartsCall, toolPartsCall, // mock will keep cycling
)
const { app, toolSpies } = buildApp({
  model,
  tools: { drug_info: stubTool({ output: { ok: true } }) },
  env: { MAX_AGENT_STEPS: 2 },
})
```

**Act**: POST a normal message.

**Assert — wire**

Event sequence ends with `step { index: 2, reason: 'capped' }` followed by `metadata`. **No `error` event.** No final `text-delta` (the model never got to produce one — it kept calling tools). No `done` event (Step 0.6 — `metadata` is terminal).

**Assert — mock**
- `callCounter.count === 2` (cap honored exactly)
- `toolSpies.drug_info` called exactly 2 times

**Assert — DB** *(strengthened per Step 0.6 §6 — cap could fire mid-tool-call, must persist cleanly)*
- Conversation has 5 messages: 1 user + 2 assistant (each with one `tool-call` part) + 2 tool (each with one `tool-result` part). No text parts.
- For every persisted `tool-call` part there is a matching `tool-result` row with the same `toolCallId` (no orphan `tool_use` — NFR-9 / F-12).
- Exactly one `usage` row exists for the conversation, with summed tokens (60 in, 20 out), linked to the **last** assistant message.

---

### I-4 — Invalid body → 400, no DB writes, no model call

**Arrange**

```ts
const { model, callCounter } = scriptModel([])  // never invoked
const { app, db } = buildApp({ model })
const before = countAllRows(db)
```

**Act — three variants** (parameterize):

| Variant | Body | Why it's invalid |
| --- | --- | --- |
| a | `{}` | missing `message` |
| b | `{ message: '' }` | empty string |
| c | `{ message: 'x'.repeat(50_001) }` | over `MAX_MESSAGE_LENGTH=50000` |

```ts
const res = await app.request('/api/chat', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(variant) })
```

**Assert — wire**
- `res.status === 400`
- `res.headers.get('content-type')` starts with `application/json` (NOT `text/event-stream`)
- Body is `{ error: { code: 'INVALID_INPUT', message: <string>, details: <array of zod issues> } }`

**Assert — state**
- `countAllRows(db) === before` (no inserts)
- `callCounter.count === 0`

---

### I-8 — Provider timeout → `UPSTREAM_TIMEOUT`

**Arrange**

A mock that *never yields* and respects `abortSignal`:

```ts
const model = new MockLanguageModelV2({
  doStream: async ({ abortSignal }) => ({
    stream: new ReadableStream({
      async pull(controller) {
        await new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
      },
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
})
const { app, db } = buildApp({ model, env: { AI_TIMEOUT_MS: 50 } })
const t0 = performance.now()
```

**Act**: POST `{ message: 'hi' }`, wait for stream close.

**Assert — wire**

```
['start', 'error']
```

`events[1].data` matches `{ code: 'UPSTREAM_TIMEOUT', message: <string> }` — no `recoverable` field (Step 0.6: errors are terminal). Stream closed (no events follow).

**Assert — timing**
- `performance.now() - t0 < 200` (close to 50 ms, not anywhere near 60 s)

**Assert — DB**
- User message persisted (we already accepted the request)
- Assistant message persisted with empty `content` array (or no assistant row, choose one and lock it; spec F-12 mandates we never persist a half-built array → empty array preferred)

**Assert — process**
- Subsequent `GET /health` returns 200 (NFR-4)

---

### I-9 — Provider error mid-stream

**Arrange**

```ts
const { model } = scriptModel([
  { type: 'tool-input-start', id: 'tu1', toolName: 'drug_info' },
  { type: 'tool-input-delta', id: 'tu1', delta: '{"que' },
  { type: 'error', error: { name: 'UpstreamError', message: 'provider blew up' } },
])
const { app, toolSpies } = buildApp({ model })
```

**Act**: POST `{ message: 'foo' }`.

**Assert — wire**

```
['start', 'tool-call-start', 'tool-call-delta', 'error']
```

`events[3].data` matches `{ code: 'UPSTREAM_ERROR', message: <string> }` — no `recoverable` field (Step 0.6).

**Assert — orchestration**
- `toolSpies.drug_info` was NOT called (tool-call was never finalized — we never reached `tool-call-end`).

**Assert — DB integrity (F-12, strengthened per Step 0.6 §6)**
- User message **is** persisted (we already accepted the request before opening the stream).
- Assistant row **is** persisted with `content: []` (the locked F-12 policy from I-8 — never write half-built; empty array is the legal "nothing to record" form).
- No `tool-call` part exists without a matching `tool-result` part anywhere in the conversation.
- Subsequent `GET /health` returns 200 (NFR-3).

---

### I-10 — Concurrent streams (NFR-7)

**Arrange**

```ts
const apps = await Promise.all(
  Array.from({ length: 10 }, () => {
    const { model } = scriptModel([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'ok' },
      { type: 'text-end',   id: 't1' },
      { type: 'finish', finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 1 } },
    ])
    return buildApp({ model })
  })
)
```

All 10 apps share **one** SQLite database file (or all use `:memory:` with shared cache, depending on test harness). WAL mode is asserted active by Slice 2's `tests/db/client.test.ts`.

**Act**

```ts
const responses = await Promise.all(
  apps.map(({ app }) =>
    app.request('/api/chat', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: `hello-${i}` }) })
  )
)
const allEvents = await Promise.all(responses.map(collectSSE))
```

**Assert**
- All 10 responses have `status === 200`.
- Every event sequence ends in `metadata` (no `error`).
- All 10 conversations exist in the DB with 2 messages each (user + assistant).
- 10 `usage` rows exist.
- No SQLite `BUSY` / `LOCKED` errors logged.

**Spec ids:** NFR-7, F-15.

---

### I-11 — Client disconnect aborts upstream (F-11)

**Arrange**

A controllable mock that yields slowly so the client has time to abort:

```ts
const upstreamAborted = { fired: false }
const model = new MockLanguageModelV2({
  doStream: async ({ abortSignal }) => {
    abortSignal?.addEventListener('abort', () => { upstreamAborted.fired = true })
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'partial' },
          // …never reaches finish; aborted before next chunk
        ],
        chunkDelayInMs: 50,
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }
  },
})
const { app, db } = buildApp({ model })
```

**Act**

```ts
const ctrl = new AbortController()
const resPromise = app.request('/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'hello' }),
  signal: ctrl.signal,
})
setTimeout(() => ctrl.abort(), 30)
let caughtAbort = false
try { await resPromise.then(collectSSE) }
catch (err) { caughtAbort = err instanceof DOMException && err.name === 'AbortError' }
```

**Assert**
- `caughtAbort === true` (client side observes abort).
- `upstreamAborted.fired === true` — the mock saw `abortSignal` fire (proves we wired `c.req.raw.signal` into `streamText`).
- DB: user message persisted; assistant row persisted with `content: []` or `[{ type: 'text', text: 'partial' }]` (whichever parts completed before abort — never half-built).
- Subsequent `GET /health` returns 200 (NFR-3).

**Spec ids:** F-11, NFR-3.

---

## Coverage Matrix

Each cell shows the test that proves the requirement.

| Spec id | Type | Proven by |
| --- | --- | --- |
| FR-1 | Streaming endpoint | I-1 |
| FR-2 | Incremental delivery | I-1 |
| FR-3 | Typed event taxonomy | I-1, I-1r, I-2 |
| FR-4 | Multi-step auto-loop | I-2 |
| FR-5 | ≥2 tools | I-2 (drug_info), Slice 4 unit (symptom_lookup) |
| FR-6 | Step cap | I-3 |
| FR-7 | Load history | I-1 (DB read on second request — verified in Slice 7) |
| FR-8 | Save history | I-1, I-2 |
| FR-9 | Persist usage | I-1 (tokens, cost), I-2 (summed) |
| FR-11 | Validation | I-4 |
| FR-12 | Structured errors | I-4, I-8, I-9 |
| FR-14 | Implicit conversation create | I-1 |
| NFR-1 | Server overhead | I-1 (latencyMs > 0) |
| NFR-2 | Timeout | I-8 |
| NFR-3 | No crash on failure | I-2e, I-8, I-9, I-10, I-11 (health check after) |
| NFR-7 | Concurrency ≥10 | I-10 |
| NFR-8 | No orphan tool_use | I-3, I-9 |
| F-1 | Provider error → graceful | I-9 |
| F-2 | Timeout → graceful | I-8 |
| F-3 | Tool throws → loop continues | I-2e |
| F-5 | Step cap | I-3 |
| F-6 | Malformed input | I-4 |
| F-11 | Client disconnect | I-11 |
| F-12 | Atomic persistence | I-3, I-8, I-9, I-11 |
| F-15 | SQLite WAL under concurrency | I-10 (+ Slice 2 PRAGMA test) |

## Tests deferred to other slices

| Spec id | Where proven |
| --- | --- |
| FR-10, FR-13, I-5, I-6 | Slice 7 (conversations / messages routes) |
| FR-15, I-7 | Slice 1 (health) |
| C-1 | Slice 5 (translate contract) |
| C-2, C-3 | Slice 5 / Slice 8 (round-trip + typecheck contracts) |
| F-4 (tool timeout) | Slice 4 (drug_info unit test) |
| F-7 (DB read fail) | Slice 8 (error middleware) |
| F-13 (env missing / unknown model) | Slice 1 (env.test.ts) |
| F-14 (tool input validation) | Slice 4 (input-validation.test.ts) |

## Definition of Done for Slice 6

- All 10 tests in this plan pass against the Slice 6 implementation.
- `bun run typecheck` clean.
- Live smoke (real `OPENROUTER_API_KEY`) returns a streaming response that fits the I-1 / I-2 shapes.
- No real network calls during `bun test`.
