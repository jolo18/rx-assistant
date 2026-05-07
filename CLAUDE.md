# rx-assistant — agentic chat for healthcare

Senior FS engineer take-home. Streaming agentic chat with voice. Currently in **Phase 1 of 4**: agentic streaming backend.

Authoritative sources:
- `ASSIGNMENT.md` — full assignment text
- `specs/phase-1-agentic-streaming-backend.md` — Phase 1 technical spec (single source of truth)
- `specs/phase-1-slice-6-test-plan.md` — detailed integration test plan for the headline slice
- `specs/data-model-review.md`, `specs/spec-review.md` — review docs with resolution audit trails
- `~/.claude/plans/read-the-assignement-file-ethereal-fog.md` — implementation plan

## Stack (Phase 1)

- Bun + TypeScript
- Hono — HTTP, SSE (`hono/streaming` `streamSSE`)
- Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider` — LLM, agent loop, tool calling
- SQLite (`bun:sqlite`) + Drizzle ORM (+ `drizzle-kit`) — persistence + migrations; WAL mode at startup
- Zod — validation
- ULID — ids
- pino — structured logging

Do **not** import `@anthropic-ai/sdk` directly. Provider portability is a hard requirement (see memory `feedback_avoid_provider_lockin.md`).

## TDD discipline

- Vertical-slice TDD: write the slice's tests first, watch them go red, implement until green, refactor.
- No code path without an exercising test.
- Tests live in `backend/tests/` and mirror `backend/src/`.
- Run: `bun test` or `bun test --watch`.
- Mock the LLM with `MockLanguageModelV2` from `ai/test`.
- After every code-generation step (each slice, each prep-step that touches files), pause and surface diff + test status for user review before advancing.

## Common commands

| Command | Effect |
| --- | --- |
| `bun install` | install deps |
| `bun test` | run all tests once |
| `bun test --watch` | TDD loop |
| `bun run dev` | dev server on :8787 |
| `bun run migrate` | apply Drizzle migrations |
| `bun run typecheck` | `tsc --noEmit` |

## Conventions

- File layout: see spec §4.5.
- IDs: ULID via `src/lib/ids.ts`.
- Errors: structured envelope `{ error: { code, message } }` via `src/lib/errors.ts`. Routes throw `HttpError`; middleware shapes the response.
- SSE wire taxonomy: spec §3.2.1. Encoded by `src/lib/sse.ts`. Translated from AI SDK `fullStream` parts in `src/agent/translate.ts`. `metadata` is the terminal happy-path event (no `done`).
- Tools: each file exports `{ description, inputSchema (zod), execute }` consumable directly by `streamText({ tools })`.
- Stored message content: `ContentPart[]` JSON blob (spec §2.4). `tool-result.output` is the AI SDK discriminated `ToolResultOutput`; `isError` is derived at translate time, not stored. Build the array in memory; single insert at end (F-12).
- Tool-result messages are their own row with `role: 'tool'` (matches AI SDK `ModelMessage`).

## Phase boundaries

- **Phase 1 (current)** — backend only. No React, no voice, no Docker.
- Phase 2 — React chat UI consuming the SSE wire format.
- Phase 3 — voice in/out.
- Phase 4 — Docker compose + CI.

Do not jump ahead.

## Constraints

- OpenRouter via the AI SDK only.
- Default model: `anthropic/claude-sonnet-4.6` (overridable via `OPENROUTER_MODEL` env). `pricing.assertKnown` runs at boot — misconfigured ids fail fast.
- DB path is plain filesystem (`DATABASE_PATH`, e.g. `./data/app.db`). Whole-stream timeout is `AI_TIMEOUT_MS` (default 60000); per-tool timeout is independent `TOOL_TIMEOUT_MS` (default 5000).
- No PHI in fixtures, seeds, prompts. Both healthcare tools surface a "not medical advice" disclaimer.
- Secrets only via env. Never log API keys.
- `DELETE /api/messages/:id` accepts only user-message ids — cascades through the rest of the turn (assistant + tool messages until next user message). 400 `INVALID_TARGET` for non-user ids.

## Adding a tool

1. `src/agent/tools/<name>.ts` exports `{ description, inputSchema, execute }`.
2. Register in `src/agent/tools/index.ts`.
3. Unit test in `backend/tests/tools/<name>.test.ts` covering happy + error + Zod input-validation failure.

## Where to look first

- New session: this file → spec.
- Why a decision was made: spec §4 / §8; or `specs/{data-model-review,spec-review}.md` Resolutions sections.
- Wire format: spec §3.2.1.
- Recurring preferences: `~/.claude/projects/-Users-jolo-Documents-rx-assitant/memory/MEMORY.md`.
- Phase 2 watchlist: deferred items from review docs (e.g. `model` column on messages) live in the Phase 2 plan when authored.
