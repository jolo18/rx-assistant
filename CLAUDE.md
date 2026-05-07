# rx-assistant — agentic chat for healthcare

Senior FS engineer take-home. Streaming agentic chat with voice. **Phase 1 backend is closed.** Currently entering **Phase 2 of 4**: React chat UI.

Authoritative sources:
- `ASSIGNMENT.md` — full assignment text
- `specs/phase-2-frontend.md` — Phase 2 frontend integration spec (active)
- `specs/archive/phase-1-agentic-streaming-backend.md` — closed Phase 1 backend spec
- `specs/archive/phase-1-slice-6-test-plan.md` — closed Phase 1 test plan
- `design/` — Claude Design handoff bundle (HTML/JSX/CSS source for the UI)
- `~/.claude/plans/...` — current plan file

## Where we are

Phase 1 backend ships **170 tests green**, full layered structured logging, live-verified OpenRouter agent loop with both healthcare tools, and structured persistence. The `/api/chat` SSE wire format is the contract Phase 2 consumes.

Verification baseline: `bun test` from `backend/` → 170 / 170. `bun run typecheck` clean.

## Stack

### Phase 1 (shipped, do not modify casually)

- Bun + TypeScript
- Hono — HTTP, SSE (`hono/streaming` `streamSSE`)
- Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider`
- SQLite (`bun:sqlite`) + Drizzle ORM (+ `drizzle-kit`); WAL mode at startup
- Zod, ULID, pino (structured layered logging)

### Phase 2 (to build)

Library choices are open within the assignment's constraints (TypeScript, React). Recommendations are recorded in `specs/phase-2-frontend.md` §3:
- **Vite + React + TypeScript** — fast dev, well-known
- **react-markdown + remark-gfm + rehype-highlight** — markdown rendering
- **Custom SSE consumer hook** — `EventSource` doesn't support POST, so hand-parse `fetch` + `ReadableStream` (~30 LOC)
- **Lightweight state** — Zustand or React context; no Redux.

Phase 3 adds the voice layer (Web Speech API + OpenAI TTS via a backend `/api/tts` endpoint). Phase 4 adds Docker + CI.

## TDD discipline

Same vertical-slice discipline as Phase 1 — write the slice's tests first, watch them go red, implement until green, refactor, pause for review, commit.

For React components, the test runner is **Vitest** (`vitest run` / `vitest --watch`) with **@testing-library/react** for component tests and **MSW** for mocking the SSE `/api/chat` endpoint. Visual regression / Storybook deferred to Phase 4.

## Common commands (Phase 2 — to be created)

| Command | Effect |
| --- | --- |
| (back-end) `cd backend && bun run dev` | Phase 1 server on `:8787` (stays untouched) |
| (back-end) `cd backend && bun test` | 170 / 170 backend tests |
| (front-end) `cd frontend && bun install` | install React deps |
| (front-end) `cd frontend && bun run dev` | Vite dev server with `/api` proxy → `:8787` |
| (front-end) `cd frontend && bun run test` | Vitest |
| (front-end) `cd frontend && bun run typecheck` | `tsc --noEmit` |

Final layout will live in `frontend/` so `backend/` stays isolated.

## How to view backend logs (carry-over from Phase 1)

`bun run dev` emits structured JSON to stdout; `bun run dev:pretty` pipes through pino-pretty for human reading. `LOG_LEVEL=debug` surfaces repo + tool layers. Every layer (`http \| service \| repo \| tool \| boot`) shares a `requestId`; the `X-Request-Id` response header lets the React UI correlate browser-side errors with server logs.

## Phase 2 conventions

- **Component file layout** — one component per file under `frontend/src/components/`; tests next to the component (`Composer.tsx` ↔ `Composer.test.tsx`).
- **SSE consumer** lives in `frontend/src/hooks/useChatStream.ts`; emits a typed state machine (`idle → submitting → streaming → done | error`).
- **Wire-format types** are imported from a shared `frontend/src/lib/wire.ts` that mirrors backend §3.2.1 (one source of truth for event names + payload shapes).
- **Design tokens** ported from `design/project/tokens.css` to `frontend/src/styles/tokens.css` verbatim (paper #EDE6D6, brick #A8463E, Source Serif 4 + Inter + JetBrains Mono).
- **Markdown rendering** — `react-markdown` with `remark-gfm` + `rehype-highlight`. Custom renderers for `<code>` blocks (theming) and tables.
- **No PHI** in fixtures. Prompts in tests are generic ("ibuprofen", "headache").

## Phase boundaries

- Phase 1 (closed) — backend
- **Phase 2 (current)** — React UI consuming the SSE wire format
- Phase 3 — voice in/out (mic + TTS endpoint)
- Phase 4 — Docker compose + CI

Do not jump ahead. Voice composer states (`recording`, `denied`) and `AudioPlayer` are present in the design source but are **Phase 3** — render them in their static "off" states for Phase 2 and wire the runtime in Phase 3.

## Constraints

- Backend stays untouched in Phase 2 unless a missing wire field is discovered. If that happens, file an issue / mini-plan and amend the spec before changing code.
- React UI must consume the SSE stream without `EventSource` (POST not supported). Hand-parse `fetch().body.getReader()`.
- `metadata` is the terminal happy-path event (no `done`); stream-close-after-metadata is the client's "stream finished" signal.
- `tool-call-result.isError` is derived; UI distinguishes success (green check) from error (warn pill).
- Conversation list view excludes `messages` for payload size; load full conversation only when one is selected.

## Adding work

Per the carry-over memories:
- Use TDD (`feedback_tdd_discipline.md`)
- Pause for review after each slice / prep-step (`feedback_pause_for_review.md`)
- Commit per slice with a conventional message (`feedback_commit_after_steps.md`)
- Avoid provider lock-in (`feedback_avoid_provider_lockin.md`) — relevant if Phase 2 adds any third-party SDK

## Where to look first

- New session, no context: this file → `specs/phase-2-frontend.md` → `design/README.md`.
- Wire format reference: `specs/archive/phase-1-agentic-streaming-backend.md` §3.2.1.
- What was built in Phase 1: `specs/archive/phase-1-agentic-streaming-backend.md` §9 (deviations log) + git log.
- Recurring preferences: `~/.claude/projects/-Users-jolo-Documents-rx-assitant/memory/MEMORY.md`.
