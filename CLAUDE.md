# rx-assistant — agentic chat for healthcare

Senior FS engineer take-home. Streaming agentic chat with voice. **Phase 1 backend is closed.** **Phase 2 frontend is closed.** Currently entering **Phase 3 of 4**: voice (mic input + TTS output).

Authoritative sources:
- `ASSIGNMENT.md` — full assignment text
- `README.md` — project overview, run/demo script, architecture diagram
- `specs/phase-3-voice.md` — Phase 3 voice spec (active)
- `specs/archive/phase-2-frontend.md` — closed Phase 2 frontend spec
- `specs/archive/phase-1-agentic-streaming-backend.md` — closed Phase 1 backend spec
- `specs/archive/phase-1-slice-6-test-plan.md` — closed Phase 1 test plan
- `design/` — Claude Design handoff bundle (HTML/JSX/CSS source for the UI)
- `~/.claude/plans/...` — current plan file

## Where we are

- **Phase 1** (backend) shipped at `62f81f3` — 170 / 170 tests, full layered structured logging, live OpenRouter agent loop, structured persistence. The `/api/chat` SSE wire format (§3.2.1 of the archived spec) is the contract.
- **Phase 2** (frontend) shipped at `2a680b2` — slices 9-18: 175 / 175 frontend tests, Vite + React 19 + react-router-dom v7, MSW-mocked SSE integration tests, 13 components ported from the design, sidebar+history+delete, dev-only `/__components` gallery. Closed by README + demo script.
- **Phase 3** (voice) is what we're starting.

Verification baseline (do this on every fresh session):

```sh
cd backend && bun test          # 170 / 170
cd frontend && bun run test     # 175 / 175
cd frontend && bun run typecheck
```

## Stack

### Phase 1 (shipped — do not modify casually)

- Bun + TypeScript
- Hono — HTTP, SSE (`hono/streaming` `streamSSE`)
- Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider`
- SQLite (`bun:sqlite`) + Drizzle ORM (+ `drizzle-kit`); WAL mode at startup
- Zod, ULID, pino (structured layered logging)

### Phase 2 (shipped — do not modify casually)

- Vite + React 19 + TypeScript + react-router-dom v7
- Vitest + @testing-library/react + MSW v2 (mocks SSE `/api/chat`)
- react-markdown + remark-gfm + rehype-highlight
- `useReducer` state machine in `useChatStream`; `<ChatStreamProvider>` lifts it above `<Routes>` so the mid-stream `/ → /c/:newId` route push survives
- Design tokens + components.css ported verbatim from `design/project/`

### Phase 3 (to build)

- **STT** — Web Speech API (`SpeechRecognition`) for in-browser dictation. Free, no backend dep. Fallback / denied state already designed in `<Composer>`.
- **TTS** — Web Speech Synthesis API (`SpeechSynthesisUtterance`) — symmetric with STT, also browser-native, also free, also no backend. The original draft's `/api/tts` route is **dropped**; backend ships zero changes in Phase 3.
- **Frontend-only voice surface** — `frontend/src/lib/tts.ts` is a thin facade around `speechSynthesis`; `frontend/src/hooks/useTts.ts` owns the per-message playback state machine. Provider-neutral interface so a future phase could swap to a server route in one file.
- **Storage** — none. `SpeechSynthesisUtterance` plays directly through the OS audio stack; nothing is ever cached or persisted.

## TDD discipline

Same vertical-slice discipline as Phases 1 + 2 — write the slice's tests first, watch them go red, implement until green, refactor, pause for review, commit. Browser APIs (mic, audio playback) are mocked via Vitest spies + jsdom polyfills; real-device verification happens in the live eyeball pass.

## Common commands

| Command | Effect |
| --- | --- |
| `cd backend && bun run dev` | Phase 1 server on `:8787`. Pretty logs: `bun run dev:pretty`. |
| `cd backend && bun test` | 170 / 170 backend tests |
| `cd backend && bun run typecheck` | `tsc --noEmit` |
| `cd frontend && bun run dev` | Vite dev server on `:5173` with `/api` proxy → `:8787` |
| `cd frontend && bun run test` | 175 / 175 frontend tests via Vitest |
| `cd frontend && bun run typecheck` | `tsc -b --noEmit` |

## How to view backend logs (carry-over from Phase 1)

`bun run dev` emits structured JSON to stdout; `bun run dev:pretty` pipes through pino-pretty for human reading. `LOG_LEVEL=debug` surfaces repo + tool layers. Every layer (`http | service | repo | tool | boot`) shares a `requestId`; the `X-Request-Id` response header lets the React UI correlate browser-side errors with server logs.

## Frontend conventions (carry-over from Phase 2)

- **Component file layout** — one component per file under `frontend/src/components/`; tests under `frontend/tests/components/`.
- **SSE consumer** lives in `frontend/src/hooks/useChatStream.ts`; emits the typed state machine `(idle → submitting → streaming → done | error)`.
- **Wire-format types** are in `frontend/src/lib/chat-events.ts` (the `ChatEvent` discriminated union, `ErrorCode`, `ContentPart`, `ToolResultOutput`). Mirrors backend §3.2.1 — single source of truth.
- **Design tokens** are in `frontend/src/styles/tokens.css` verbatim (paper `#EDE6D6`, brick `#A8463E`, Source Serif 4 + Inter + JetBrains Mono).
- **Markdown rendering** — `react-markdown` with `remark-gfm` + `rehype-highlight`. `<pre>` blocks wrap inside the column (`white-space: pre-wrap; overflow-wrap: anywhere`).
- **No PHI** in fixtures. Prompts in tests are generic ("ibuprofen", "headache").

## Phase boundaries

- Phase 1 (closed) — backend
- Phase 2 (closed) — React UI consuming the SSE wire format
- **Phase 3 (current)** — voice in (`<Composer>` mic) / out (`<AudioPlayer>` + `/api/tts`)
- Phase 4 — Docker compose + CI

Do not jump ahead. The Phase 2 ornamental decisions (live-only `<CappedNotice>` / `<ErrorPill>`, "Complete" label on historical tool calls) are deliberate — see `specs/archive/phase-2-frontend.md` §1.4. Don't try to re-implement them server-side as part of Phase 3.

## Phase 3 entry points (read these before slice 19)

1. `specs/phase-3-voice.md` — active spec.
2. `frontend/src/components/Composer.tsx` — mic + TTS buttons currently `disabled` with native `title` tooltips. Phase 3 lifts the `disabled` attribute and wires runtimes; no other refactors needed.
3. `design/project/components.jsx` line 393 — `AudioPlayer({ variant, playing, elapsed, total })`. Already styled in `frontend/src/styles/components.css` (`.rx-audio*`); just needs porting to `frontend/src/components/AudioPlayer.tsx`.

## Constraints

- Phase 1 + Phase 2 stay untouched unless Phase 3 surfaces a missing wire field. If that happens, amend the spec before changing code.
- **Voice components in Phase 2** render `disabled` with hover tooltips. Phase 3 lifts the `disabled` and wires the runtimes — no other refactors required.
- **Phase 3 ships zero backend changes.** All voice work is in `frontend/`. Mic uses `SpeechRecognition`, TTS uses `SpeechSynthesisUtterance`. Backend stays at 170 / 170 unless an unrelated bug surfaces.
- Web Speech APIs are browser-only. Tests mock `window.SpeechRecognition` / `webkitSpeechRecognition` / `window.speechSynthesis`. Real-device verification (Safari + Chrome on macOS, mobile Safari) is required before slice closure — TTS quality varies by OS voices and iOS Safari requires a user gesture for the first `speak()` call.
- AudioPlayer scrub is read-only — `SpeechSynthesisUtterance` doesn't expose duration. Progress is approximated via the `boundary` event's `charIndex / text.length`.

## Adding work

Per the carry-over memories:
- Use TDD (`feedback_tdd_discipline.md`)
- Pause for review after each slice / prep-step (`feedback_pause_for_review.md`)
- Commit per slice with a conventional message (`feedback_commit_after_steps.md`)
- Avoid provider lock-in (`feedback_avoid_provider_lockin.md`) — wrap any TTS provider behind a thin facade.

## Where to look first

- New session, no context: this file → `specs/phase-3-voice.md` → `README.md`.
- Wire format reference: `specs/archive/phase-1-agentic-streaming-backend.md` §3.2.1.
- What was built in Phase 1 / 2: archived specs + `git log --oneline --grep="slice"`.
- Recurring preferences: `~/.claude/projects/-Users-jolo-Documents-rx-assitant/memory/MEMORY.md`.
