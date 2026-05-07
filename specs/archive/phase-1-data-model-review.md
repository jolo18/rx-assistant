# Data Model Review — Phase 1 Spec

> Source: `specs/phase-1-agentic-streaming-backend.md` §2 (Data Model).
> Reviewer notes captured 2026-05-07.

## Context

The Phase 1 spec defines a SQLite schema (`conversations` / `messages` / `usage`), with messages stored as a JSON content-parts blob mirroring the Vercel AI SDK `ModelMessage` shape so history can be replayed verbatim into `streamText({ messages })`. This document captures issues found while reviewing §2 against the rest of the spec (§3 APIs, §4.7 internal contracts, §6 tests). Action: resolve the inconsistencies below before Phase 1 implementation begins.

---

## Inconsistencies / bugs

### 1. Role enum contradicts itself (blocking)

- `messages.role` CHECK in §2.2 allows `'user' | 'assistant'` only, with a note that "tool_results live inside user-role content blocks per Anthropic spec".
- §2.4 `StoredMessage` types `role: 'user' | 'assistant' | 'tool'`.
- §4.7 `AppendMessageInput` also types `role: 'user' | 'assistant' | 'tool'`.
- §2.4 explicitly says it "Mirrors the Vercel AI SDK `ModelMessage` content-parts shape" — and AI SDK v5 does have a `ToolModelMessage` whose role is `'tool'`.

**Pick one:**
- **(a)** Add `'tool'` to the DB CHECK constraint and store tool-result messages as their own row. Keeps round-trip into `streamText({ messages })` lossless and matches the §2.4 / §4.7 type unions as written.
- **(b)** Remove `'tool'` from the TS unions in §2.4 and §4.7. Tool results get packed into a synthetic `user`-role message's `content` array at write time, and unpacked back into a `tool` role at read time. Matches the Anthropic Messages API convention but adds a translation layer the spec currently doesn't describe.

The schema as currently written will reject what the type system permits.

### 2. `ToolResultPart.output` shape isn't AI-SDK-faithful

- Spec stores `{ output: unknown; isError?: boolean }`.
- AI SDK v5 actually uses a discriminated `ToolResultOutput`: `{ type: 'json' | 'text' | 'error-json' | 'error-text' | 'content', value }`.
- §2.4's stated goal is lossless round-trip into `streamText({ messages })` — this flat shape collapses `error-text` and `error-json` into a single `isError` boolean and loses the `text` vs `json` distinction for success cases.

**Fix:** either store the AI-SDK `ToolResultOutput` shape directly, or document the explicit mapping in `agent/translate.ts` and ensure load-from-DB rebuilds the discriminated shape.

---

## Minor concerns

### 3. `(conversation_id, position)` should be UNIQUE, not just indexed

§2.2 declares it as an index. Position is described as a "dense rank" with re-numbering on delete (FR-13, U-6); without UNIQUE, two rows can share a position under a write race.

Caveat: with UNIQUE, the re-numbering pass after delete needs either `DEFERRABLE` constraints (not supported in SQLite) or a two-pass update inside a transaction (shift to negative offsets, then to final values). Worth calling out in the implementation notes.

### 4. `usage.message_id UNIQUE` — confirm one-row-per-assistant-turn

The constraint is correct, but FR-9 says usage is "summed across all loop iterations" and §2.3 confirms input/output tokens are summed. The agent service must accumulate `step-finish` token counts in memory and write a single `usage` row after the final `finish` event — not one per step. Worth an explicit assertion in tests (e.g. an integration variant of I-2 that checks one usage row exists for a multi-step turn).

### 5. No `model` column on `messages`

Recoverable via `messages → usage.model` join, but only for assistant rows. If a conversation ever spans multiple models (per-request `model` override is supported in §3.2), display logic without a join becomes awkward. Not blocking; flag for Phase 2 if the UI needs it.

### 6. Cost-table key drift

`usage.model` stores the OpenRouter id (e.g. `anthropic/claude-sonnet-4.5`); `pricing.ts` is keyed by model id. The same exact string must be used for both — including when `ANTHROPIC_MODEL` is overridden per request — or costs silently fall back to 0 / unknown. Add a unit test (extension of U-1) that fails loudly if `usage.model` doesn't resolve in the price table.

---

## Looks good

- ULID PKs, epoch-ms `INTEGER` timestamps, `ON DELETE CASCADE` rules.
- JSON-blob justification in §2.4 is sound for Phase 1 scope.
- `cache_read_tokens` / `cache_create_tokens` captured even though prompt caching isn't tuned in Phase 1 — cheap to record now, useful later.
- `usage` keyed off `message_id` with cascade keeps orphan-prevention trivial.

---

## Verdict

Issue **#1 (role enum)** is the only one I'd block implementation on. **#2 (tool-result shape)** is a correctness risk for the lossless-replay goal and should be resolved before writing `agent/translate.ts`. The rest are tightening passes.

---

## Resolutions (2026-05-07)

Applied as Step 0.5 of the implementation plan. Each row links the issue to the spec/test-plan edit that resolves it.

| # | Issue | Resolution | Edits |
| --- | --- | --- | --- |
| 1 | Role enum contradicts itself | **Option (a)** — DB CHECK includes `'tool'`; tool-result messages occupy their own row with `role: 'tool'`. Matches AI SDK v5 `ToolModelMessage` and the existing §4.7 `AppendMessageInput` type. | `phase-1-agentic-streaming-backend.md` §2.2 row updated |
| 2 | `ToolResultPart.output` shape isn't AI-SDK-faithful | Adopted AI SDK v5 discriminated `ToolResultOutput` (`json` / `text` / `error-text` / `error-json` / `content`). `isError` removed from storage; derived at translate time as `output.type.startsWith('error-')`. Wire format keeps `isError` for UI convenience. | `phase-1-agentic-streaming-backend.md` §2.4 class diagram + TS code; §3.2.1 `tool-call-result` row note |
| 3 | `(conversation_id, position)` should be UNIQUE | Added UNIQUE constraint; `deleteAndRenumber` documented as a two-pass shift via negative offsets inside a transaction (single-statement form rejected by SQLite under UNIQUE). | `phase-1-agentic-streaming-backend.md` §2.2 Constraints + Implementation note |
| 4 | `usage.message_id UNIQUE` — confirm one-row-per-turn | Already enforced by DB. Added explicit Slice 6 I-2 assertion: `SELECT COUNT(*) FROM usage WHERE message_id IN (<assistant ids>) === 1` after a multi-step turn. | `phase-1-slice-6-test-plan.md` I-2 DB block |
| 5 | No `model` column on `messages` | **Deferred to Phase 2** per reviewer's recommendation (non-blocking). Documented in `CLAUDE.md` "Where to look first" as a watchlist item. | `CLAUDE.md` (Phase 2 watchlist note) |
| 6 | Cost-table key drift | `pricing.calculate` throws `UnknownModelError` on unknown model id; `pricing.assertKnown(env.OPENROUTER_MODEL)` is invoked at server startup in Slice 3 (avoids backwards dep from Slice 1's `env.ts`). U-1 extended to assert behavior. | Plan `~/.claude/plans/...` Slice 1 + Slice 3 notes; spec edit pending in Step 0.6 (env rename) |

Issue #5 remains open as a Phase 2 task. All other issues are resolved.
