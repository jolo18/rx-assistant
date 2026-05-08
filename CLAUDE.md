# rx-assistant — agentic chat for healthcare

Senior FS engineer take-home. Streaming agentic chat with voice. **Phases 1-3 are closed.** Currently at the **Phase 4 of 4** entry: Docker compose + CI.

Authoritative sources:
- `ASSIGNMENT.md` — full assignment text
- `README.md` — project overview, architecture diagram, end-to-end demo script (incl. the voice steps from Phase 3)
- `specs/archive/phase-3-voice.md` — closed Phase 3 voice spec
- `specs/archive/phase-2-frontend.md` — closed Phase 2 frontend spec
- `specs/archive/phase-1-agentic-streaming-backend.md` — closed Phase 1 backend spec
- `specs/archive/phase-1-slice-6-test-plan.md` — closed Phase 1 test plan
- `design/` — Claude Design handoff bundle (HTML/JSX/CSS source for the UI)
- `~/.claude/plans/...` — current plan file

## Where we are

- **Phase 1** (backend) shipped at `62f81f3` — 170 / 170 tests, full layered structured logging, live OpenRouter agent loop with two healthcare tools, structured persistence. The `/api/chat` SSE wire format (§3.2.1 of the archived spec) is the contract.
- **Phase 2** (frontend) shipped at `2a680b2` — slices 9-18: 175 / 175 frontend tests, Vite + React 19 + react-router-dom v7, MSW-mocked SSE integration tests, 13 components ported from the design, sidebar+history+delete, dev-only `/__components` gallery.
- **Phase 3** (voice) shipped — slices 19-22: STT via Web Speech API (`SpeechRecognition` with a 5s manual silence timer), TTS via Web Speech Synthesis API (`SpeechSynthesisUtterance` chunked at ≤500 chars). Backend untouched in Phase 3. Frontend test count at the close: **220 / 220**.
- **Phase 4** (Docker + CI) is what's next.

Verification baseline (do this on every fresh session):

```sh
cd backend && bun test          # 170 / 170
cd frontend && bun run test     # 220 / 220
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

### Phase 3 (shipped — do not modify casually)

- **STT** via Web Speech API. `frontend/src/hooks/useSpeechRecognition.ts` runs `continuous = true` with a manual 5s silence timer; iterates results from `event.resultIndex` (Chrome's canonical pattern) so cumulative results don't double-count. `onTranscript(finalText)` fires once on settle.
- **TTS** via Web Speech Synthesis API. `frontend/src/hooks/useTts.ts` chunks text via `frontend/src/lib/tts.ts` `chunkText(≤500)` and queues chunks via `onend → speak(next)` to dodge Chrome's ~15s utterance cap. Single global "now-speaking" — replays cancel prior. `<AudioPlayer>` scrub is read-only (no seek; SpeechSynthesisUtterance doesn't expose duration).
- TTS preference persisted in localStorage (`rx-tts-on`) via `useTtsPreference`. Auto-play on settle scoped to the live MessageList; historical turns get manual play only.
- Limitation accepted: voice quality is OS-dependent (mac/iOS voices best; Linux/Windows rougher). Demo recorded on macOS.

### Phase 4 (to build)

- **Docker compose** for backend + frontend + (optionally) a sqlite-volume mount.
- **CI** — GitHub Actions running `bun test` for both packages + `bun run typecheck` on PRs and main.
- No spec written yet; draft at slice 23 entry.

## TDD discipline

Same vertical-slice discipline as Phases 1 + 2 + 3 — write the slice's tests first, watch them go red, implement until green, refactor, pause for review, commit.

## Common commands

| Command | Effect |
| --- | --- |
| `cd backend && bun run dev` | Phase 1 server on `:8787`. Pretty logs: `bun run dev:pretty`. |
| `cd backend && bun test` | 170 / 170 backend tests |
| `cd backend && bun run typecheck` | `tsc --noEmit` |
| `cd frontend && bun run dev` | Vite dev server on `:5173` with `/api` proxy → `:8787` |
| `cd frontend && bun run test` | 220 / 220 frontend tests via Vitest |
| `cd frontend && bun run typecheck` | `tsc -b --noEmit` |

## How to view backend logs (carry-over from Phase 1)

`bun run dev` emits structured JSON to stdout; `bun run dev:pretty` pipes through pino-pretty for human reading. `LOG_LEVEL=debug` surfaces repo + tool layers. Every layer (`http | service | repo | tool | boot`) shares a `requestId`; the `X-Request-Id` response header lets the React UI correlate browser-side errors with server logs.

## Frontend conventions (carry-over from Phases 2-3)

- **Component file layout** — one component per file under `frontend/src/components/`; tests under `frontend/tests/components/`.
- **SSE consumer** lives in `frontend/src/hooks/useChatStream.ts`; emits the typed state machine `(idle → submitting → streaming → done | error)`.
- **Wire-format types** are in `frontend/src/lib/chat-events.ts` (the `ChatEvent` discriminated union, `ErrorCode`, `ContentPart`, `ToolResultOutput`). Mirrors backend §3.2.1 — single source of truth.
- **Voice surface** — `useSpeechRecognition` + `useTts` are the only mic / TTS entry points. `lib/tts.ts` is the provider-neutral facade (provider-swap is a one-file change).
- **Design tokens** are in `frontend/src/styles/tokens.css` verbatim (paper `#EDE6D6`, brick `#A8463E`, Source Serif 4 + Inter + JetBrains Mono).
- **Markdown rendering** — `react-markdown` with `remark-gfm` + `rehype-highlight`. `<pre>` blocks wrap inside the column (`white-space: pre-wrap; overflow-wrap: anywhere`).
- **No PHI** in fixtures. Prompts in tests are generic ("ibuprofen", "headache").

## Phase boundaries

- Phase 1 (closed) — backend
- Phase 2 (closed) — React UI consuming the SSE wire format
- Phase 3 (closed) — voice in (`<Composer>` mic) / out (`<AudioPlayer>` + Web Speech Synthesis)
- **Phase 4 (current)** — Docker compose + CI

Don't modify shipped phases unless the new work surfaces a real bug. Phase 4 is purely infra.

## Constraints

- All shipped phases (1, 2, 3) stay untouched unless a bug fix is genuinely blocking Phase 4 (CI catches a flake, Docker exposes an env-loading bug, etc.). If that happens, file a small fix commit + flag in the closure spec.
- Voice surfaces use `window.SpeechRecognition` / `window.speechSynthesis`. Tests mock both globals via Vitest spies. Real-device verification (Safari + Chrome on macOS) is needed before any voice-related fix lands.

## Adding work

Per the carry-over memories:
- Use TDD (`feedback_tdd_discipline.md`)
- Pause for review after each slice / prep-step (`feedback_pause_for_review.md`)
- Commit per slice with a conventional message (`feedback_commit_after_steps.md`)
- Avoid provider lock-in (`feedback_avoid_provider_lockin.md`)

## Where to look first

- New session, no context: this file → `README.md` → `specs/phase-4-deploy-ci.md` (once written).
- Wire format reference: `specs/archive/phase-1-agentic-streaming-backend.md` §3.2.1.
- What was built in each phase: archived specs + `git log --oneline --grep="slice"`.
- Recurring preferences: `~/.claude/projects/-Users-jolo-Documents-rx-assitant/memory/MEMORY.md`.
