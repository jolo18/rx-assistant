# rx-assistant — agentic chat for healthcare

Senior FS engineer take-home. **All four phases are closed.** The repo is the final submission.

Authoritative sources:
- `ASSIGNMENT.md` — full assignment text
- `README.md` — project overview, architecture diagram, run-with-docker quickstart, end-to-end demo script
- `specs/archive/phase-4-deploy-ci.md` — closed Phase 4 DevOps spec
- `specs/archive/phase-3-voice.md` — closed Phase 3 voice spec
- `specs/archive/phase-2-frontend.md` — closed Phase 2 frontend spec
- `specs/archive/phase-1-agentic-streaming-backend.md` — closed Phase 1 backend spec
- `specs/archive/phase-1-slice-6-test-plan.md` — closed Phase 1 test plan
- `design/` — Claude Design handoff bundle (HTML/JSX/CSS source for the UI)
- `~/.claude/plans/...` — current plan file

## What shipped

| Phase | Closed at | Tests | Highlights |
| --- | --- | --- | --- |
| 1 — Backend | `62f81f3` | 170 / 170 | Bun + Hono + Vercel AI SDK + OpenRouter, SSE wire format, Drizzle/SQLite, structured pino logging |
| 2 — Frontend | `2a680b2` | 175 / 175 | Vite + React 19 + react-router-dom v7, MSW-mocked SSE integration tests, design ported verbatim |
| 3 — Voice | `3badd52` | 220 / 220 | Web Speech API for STT (5s manual silence), Web Speech Synthesis API for TTS (chunked at ≤500 chars). Backend untouched. |
| 4 — DevOps | (this commit) | 170 + 220 | `oven/bun:1-slim` Dockerfiles, healthy-dependency-gated docker-compose, automated migration on entrypoint, GitHub Actions CI |

Verification baseline (do this on every fresh session):

```sh
cd backend && bun test          # 170 / 170
cd frontend && bun run test     # 220 / 220
cd frontend && bun run typecheck
docker compose up -d --build && curl http://localhost:8787/health
```

## Stack at a glance

- **Backend** — Bun + Hono SSE, Vercel AI SDK + OpenRouter, SQLite via Drizzle. Image: `oven/bun:1-slim`, non-root `rx` user (uid 1001), 369 MB.
- **Frontend** — Vite + React 19 + react-router-dom v7. Vitest + RTL + MSW v2. Markdown via react-markdown + remark-gfm + rehype-highlight. Image: multi-stage `oven/bun:1-slim` build → `nginx:1-alpine` serve, 92.7 MB.
- **Voice** — both surfaces are browser-native: `SpeechRecognition` for STT, `SpeechSynthesisUtterance` for TTS. No backend route, no API key, no GPU. Per-message playback chunking dodges Chrome's ~15s utterance cap.
- **DevOps** — `docker compose up` from a clean clone. Backend healthcheck gates the frontend service via `depends_on.condition: service_healthy`. nginx proxies `/api/*` to the backend with `proxy_buffering off` (load-bearing for SSE). GitHub Actions CI runs the test matrix + a compose smoke (build → up → poll /health → curl proxy → down -v).

## TDD discipline (kept across all four phases)

Vertical-slice TDD — write the slice's tests first, watch them go red, implement until green, refactor, pause for review, commit. Slice numbering ran 1 (backend boot) → 25 (Phase 4 closure).

## Common commands

| Command | Effect |
| --- | --- |
| `cd backend && bun run dev` | Backend on `:8787`. Pretty logs: `bun run dev:pretty`. |
| `cd backend && bun test` | 170 / 170 backend tests |
| `cd backend && bun run typecheck` | `tsc --noEmit` |
| `cd frontend && bun run dev` | Vite dev server on `:5173` with `/api` proxy → `:8787` |
| `cd frontend && bun run test` | 220 / 220 frontend tests via Vitest |
| `cd frontend && bun run typecheck` | `tsc -b --noEmit` |
| `docker compose up -d --build` | Brings up the full stack (backend + frontend) |
| `docker compose logs -f backend` | Live structured pino JSON from the backend container |
| `docker compose down -v` | Stop everything + clear sqlite volume |

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

## DevOps conventions (carry-over from Phase 4)

- **Backend image** runs as non-root uid 1001. Migrations run via `docker-entrypoint.sh` *before* `bun run start`. `exec "$@"` is load-bearing for signal forwarding.
- **Frontend image** is multi-stage; the runtime layer is `nginx:1-alpine` with `proxy_buffering off` on the `/api/*` upstream (load-bearing for SSE).
- **`backend/.env.example`** annotates every variable as `[REQUIRED]`, `[SECRET]`, or `[DEFAULT: …]`.
- **CI** runs the test matrix + a compose smoke job (build → up → poll /health → curl proxy → down -v). `OPENROUTER_API_KEY` is stubbed in CI; /api/chat isn't exercised.

## Phase boundaries

All four phases are now closed. There is no active phase — the repo is the submission.

If a fix becomes necessary post-submission:
- Treat it as a **bugfix commit**, not a new slice. Conventional commit type: `fix(...)`.
- Update the relevant archived spec's deviation log if the fix changes documented behavior.
- Re-run the verification baseline before committing.

## Where to look first

- New session, no context: this file → `README.md` → `git log --oneline --grep="slice"` for the development arc.
- Wire format reference: `specs/archive/phase-1-agentic-streaming-backend.md` §3.2.1.
- Recurring preferences: `~/.claude/projects/-Users-jolo-Documents-rx-assitant/memory/MEMORY.md`.
