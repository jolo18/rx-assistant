# Spec Review — Phase 1 (excluding §2 Data Model)

> Source: `specs/phase-1-agentic-streaming-backend.md`.
> Covers §1, §3–§8. Data-model issues live in `specs/data-model-review.md`.
> Reviewer notes captured 2026-05-07.

---

## §1 Requirements

- **FR-13 has no read endpoint.** "Messages individually addressable (load by id, delete by id)" — §3.1 only has `DELETE /api/messages/:id`, no `GET /api/messages/:id`. Either add the GET, or rephrase FR-13 to "addressable via conversation load + delete by id".
- **FR-14 vs F-10 collision is implicit.** FR-14 says "conversation created implicitly if `conversationId` does not yet exist" — but F-10 says provided-but-unknown id returns 404. The reconciling rule is "implicit create only when id is *absent*", and that should be stated in FR-14, not buried in F-10.
- **FR-7 has no truncation policy.** "Full prior turns loaded before each request" → token cost grows linearly per turn, hits the model's context limit eventually. Fine for take-home scope, but call it out as a known limitation rather than leaving it implicit.
- **NFR-1 (TTFB < 1.5s p95) is unenforceable.** Qualified with "provider permitting", which makes it aspirational. Either drop it or scope it to "server overhead before first byte from provider".

## §3 APIs

- **User-message id is never surfaced to the client.** `start` event carries the *assistant* `messageId`. The user message is persisted server-side with its own id, but the client has no way to learn it. That breaks `DELETE /api/messages/:id` for user messages from a UI that didn't generate the id locally. Fix: include `userMessageId` in the `start` event, or echo it in a separate event.
- **`step.reason` enum is incomplete.** §3.2.1 lists `'tool' | 'final' | 'capped'`, but AI SDK `step-finish` carries `finishReason` including `'length'` (max tokens), `'content-filter'`, `'error'`. Either map them all explicitly or document which ones get routed to `error` instead.
- **`error.recoverable: boolean` has no defined client semantics.** Spec doesn't say what the client should do on `recoverable: true`. Drop it or define it (retry? resume?).
- **`metadata` event omits cache tokens.** §2.3 stores `cache_read_tokens` / `cache_create_tokens`; §3.2.1 `metadata` event doesn't expose them. Free observability the client could surface — extend the payload.
- **`done` is redundant after `metadata`.** Both fire at end of stream. Fold `done`'s `messageId` into `metadata` and drop one event.
- **Deleting a single message inside a multi-step turn breaks NFR-9.** §3.3 says `DELETE /api/messages/:id` re-numbers position, but if the deleted message was an assistant turn containing tool_use blocks, the next history load has tool_use without the corresponding tool_result. Spec needs one of: restrict delete to user messages, cascade-delete the whole turn, or sanitize at load time. This is a real gap, not a nit.
- **`RATE_LIMITED` error code is in §3.4 but rate limiting is explicitly out of scope (§1.3).** Either remove or note it's reserved for upstream provider 429 propagation.

## §4 Architecture

- **Default model is one minor version behind.** §4.1 sets `anthropic/claude-sonnet-4.5` as default; latest Sonnet is `4.6`. May be intentional (cost), but flag it.
- **Env var name `ANTHROPIC_MODEL` is misleading.** With OpenRouter as the provider, the model could be `openai/gpt-4o` or `google/gemini-2.5-pro`. Rename to `DEFAULT_MODEL` or `OPENROUTER_MODEL` so the env doesn't lie.
- **`DATABASE_URL=file:./data/app.db` will trip `bun:sqlite`.** Bun's SQLite driver wants a plain filesystem path, not a libsql `file:` URL. Either store as path-only or document the prefix-stripping in `db/client.ts`.
- **`AI_TIMEOUT_MS=60000` is the whole-stream timeout, but the spec also wants per-tool 5s timeout (F-4).** Make sure these are independent budgets, not overlapping. Worth a note in §4.6.
- **`RunAgentArgs.conversationId: string | null`** in §4.7 vs `conversationId?: string` in the §3.2 request body — pick one (`null` vs `undefined`) and propagate through the zod schema.
- **`event: start` is emitted before `streamText` is called.** If the upstream call throws synchronously (bad key, bad model id) post-start, the translator must turn that into an `error` event mid-stream. Spec covers this conceptually but `agent/translate.ts` should explicitly handle "exception while iterating fullStream".

## §6 Test Cases

- **No runtime round-trip test for stored messages.** C-2 is "typecheck-only", which won't catch the tool-result shape collapse called out in `data-model-review.md` §2. Add: "load conversation from DB → pass `messages` to `streamText` → assert no validation error."
- **I-3 (step cap) doesn't assert assistant message persistence.** Cap could fire mid-tool-call. Assert (a) a final assistant message exists, (b) no orphan `tool_use` without `tool_result`.
- **I-9 (provider error mid-stream) doesn't assert partial-message persistence.** F-1 says "persist what we have"; the test only checks the error event.
- **No concurrency test for NFR-8 (≥10 concurrent streams).** Easy to add with `Promise.all` over the test app — would also smoke-test SQLite locking.
- **No test that `usage.model` resolves in `pricing.ts`.** Already flagged in `data-model-review.md` §6.
- **No test for client disconnect aborting upstream.** F-11 says "manual test" but `fetch` + `AbortController` makes this trivially automatable.

## §7 Failure Modes

- **F-13 ambiguous.** "Validate env at boot; fail fast" *and* "/health reports ok:false until set" — these are contradictory. If you fail fast at boot, /health never gets a chance to say `ok:false`. Pick one (recommend fail-fast).
- **Missing: tool input validation failure.** Model emits `tool_use` whose `input` doesn't match the tool's zod schema. Should be a `tool_result{is_error:true, "invalid input"}` continuation, parallel to F-8.
- **Missing: SQLite `BUSY`/`LOCKED` under concurrent writes.** §4.1 doesn't specify WAL mode. Add a startup `PRAGMA journal_mode=WAL` and document it as the F-N mitigation, or accept the risk explicitly.
- **F-7 covers post-stream DB failure but not pre-stream.** What if history load fails? Spec implies 500/INTERNAL but should say so.

---

## What's good

- Stream taxonomy mapping (§3.2.1) is the strongest part of the spec — clear wire/AI-SDK correspondence.
- Failure modes table (§7) is unusually thorough for a spec of this scope.
- Architecture is provider-agnostic (Vercel AI SDK + OpenRouter), which matches the project's stated preference for avoiding native-SDK lock-in.
- Folder layout (§4.5) is clean and matches the test layout 1:1.

---

## Resolutions (2026-05-07)

Applied as Step 0.6 of the implementation plan.

### §1 Requirements

| Issue | Resolution | Edit |
| --- | --- | --- |
| FR-13 has no read endpoint | Rephrased: "addressable via conversation load + DELETE by id (user-only)". No new GET endpoint. | spec §1.1 FR-13 row |
| FR-14 vs F-10 collision | Reworded FR-14 to be the single source of truth: absent → create; present-but-unknown → 404. | spec §1.1 FR-14 row |
| FR-7 truncation policy | Documented as known limitation in §1.3. | spec §1.3 |
| NFR-1 unenforceable | Dropped. NFR table renumbered (NFR-1 is now "server overhead" — was NFR-2). | spec §1.2 |

### §3 APIs

| Issue | Resolution | Edit |
| --- | --- | --- |
| User-message id not surfaced | `start` payload now includes `userMessageId`. | spec §3.2.1 |
| `step.reason` enum incomplete | Kept enum at `'tool' \| 'final' \| 'capped'`. Added explicit `finishReason` → wire-event mapping table; abnormal values (`length`, `content-filter`, `error`, `other`) route to `error` events with codes `UPSTREAM_TRUNCATED` / `CONTENT_FILTERED` / `UPSTREAM_ERROR`. | spec §3.2.1 |
| `error.recoverable` undefined | Field dropped — errors are terminal. | spec §3.2.1 + slice-6 test plan I-8/I-9 |
| `metadata` omits cache tokens | `cacheReadTokens`, `cacheCreateTokens` added to payload. | spec §3.2.1 |
| `done` redundant after `metadata` | `done` event removed. `metadata` is the terminal happy-path event; client treats stream-close as "done". | spec §3.2.1 + slice-6 test plan event-order assertions |
| DELETE message breaks NFR-9 | Endpoint now accepts only user-message ids; cascades through the rest of the turn; renumbers atomically. 400 `INVALID_TARGET` for non-user ids. | spec §3.1, §3.3; slice-6 plan defers test to Slice 7 |
| `RATE_LIMITED` in §3.4 vs §1.3 | Kept code, added reservation note: propagates upstream provider 429s only; we don't rate-limit ourselves. | spec §3.4, §1.3 |

### §4 Architecture

| Issue | Resolution | Edit |
| --- | --- | --- |
| Default model one minor version behind | Updated to `anthropic/claude-sonnet-4.6`. | spec §4.1, §4.6 |
| `ANTHROPIC_MODEL` misleading | Renamed to `OPENROUTER_MODEL`. | spec §4.1, §4.6; CLAUDE.md; plan Slice 1/3 |
| `DATABASE_URL` libsql-style | Renamed to `DATABASE_PATH`, plain filesystem path. | spec §4.6 |
| `AI_TIMEOUT_MS` overlaps tool timeout | Added `TOOL_TIMEOUT_MS` (default 5000), independent budget; documented in §4.6. | spec §4.6 |
| `RunAgentArgs.conversationId` shape mismatch | Standardized on `?: string` (undefined). Zod schema rejects `null`. | spec §3.2 + §4.7 |
| Mid-stream exception handling implicit | New §4.8 spelling out the try/catch wrapper around the `for await fullStream` loop, with persisted-partial / `error` event semantics. F-1, F-2, F-7, F-11 all funnel through this. | spec §4.8 (new) |

### §6 Test Cases

| Issue | Resolution | Edit |
| --- | --- | --- |
| No runtime round-trip test | Added C-3: persist multi-step conversation → load → pass to `streamText({ messages, model: mockModel })` → assert no validation error. Lives in Slice 5. | spec §6.3 |
| I-3 doesn't assert persistence | Strengthened DB assertions: 5 messages, every `tool-call` has matching `tool-result`, exactly one `usage` row. | slice-6 test plan I-3 |
| I-9 doesn't assert partial persistence | Strengthened: user message persisted, assistant row persisted with `content: []`, no orphans, health endpoint still 200. | slice-6 test plan I-9 |
| No NFR-7 concurrency test | Added I-10: 10 parallel `/api/chat` calls, all 200, all persisted, no SQLite errors. | slice-6 test plan |
| No `usage.model` ↔ `pricing` test | Already covered by Step 0.5 #6's extended U-1 (Slice 3). | — |
| No client disconnect test | Added I-11: `AbortController.abort()` mid-stream; mock observes `abortSignal`; partial persisted; health 200. | slice-6 test plan |

### §7 Failure Modes

| Issue | Resolution | Edit |
| --- | --- | --- |
| F-13 ambiguous | Rewritten: fail-fast at boot only. No `/health` "ok:false" middle ground. Includes both `OPENROUTER_API_KEY` missing and `OPENROUTER_MODEL` unknown via `pricing.assertKnown`. | spec §7 F-13 |
| Missing tool input validation | New F-14: AI SDK's `tool({ inputSchema })` validates and surfaces `tool-result { type: 'error-json' }` automatically. Verified by Slice 4 unit test. | spec §7 F-14 |
| Missing SQLite BUSY/LOCKED | New F-15: `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL` at startup. Required for I-10. | spec §7 F-15; plan Slice 2 |
| F-7 missing pre-stream | Extended: pre-stream history-load failure → 500 `INTERNAL` envelope; mid/post-stream → `error` SSE event via §4.8 wrapper. | spec §7 F-7 |

All 25 issues resolved. No deferrals.
