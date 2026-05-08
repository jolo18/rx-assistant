# Phase 3 — Voice (mic input + TTS output)

> **Phase 1 reference:** `specs/archive/phase-1-agentic-streaming-backend.md` (closed at `62f81f3`).
> **Phase 2 reference:** `specs/archive/phase-2-frontend.md` (closed at `2a680b2`). 175 / 175 frontend tests, 170 / 170 backend.
> **Pre-existing voice surface:** `<Composer>` mic + TTS render `disabled` with native `title="Voice input arrives in Phase 3"` / `title="Spoken replies arrive in Phase 3"`; the design source's `<AudioPlayer>` is fully styled (`.rx-audio*` classes) but currently unmounted. Phase 3's job is to lift the `disabled` and wire the runtimes — no other Phase 2 refactors required.

---

## 1. Goal & success criteria

Add **bidirectional voice** to the chat:

- **Voice in** — user holds (or taps) the composer mic, speaks a question, sees the recognized transcript in the textarea, taps Send (or auto-submits).
- **Voice out** — settled assistant responses can be played back as audio. A TTS toggle in the composer picks between text-only ("off") and "auto-play on settle" ("on"); each `<AudioPlayer>` next to a message also has a manual play / pause / scrub.

End-of-phase ships when:

1. `cd backend && bun test` — green, including the new `/api/tts` route tests.
2. `cd frontend && bun run test` — green, including STT hook tests + AudioPlayer tests + integration tests for the auto-play path.
3. Live demo: speak a healthcare prompt → the textarea fills with the transcript → submit → the answer streams + auto-plays via `<AudioPlayer>`.
4. Mic button shows a permission-denied state (per the design's S-5 screen) when the user blocks microphone access.
5. Browser unsupported (e.g. Firefox without Web Speech) → mic stays `disabled` with copy "Voice input not supported in this browser." TTS still works (it doesn't depend on the browser API).
6. Recording-ready: a continuous narrated demo can show mic → answer → playback without fighting the UI.

---

## 2. Provider choices (locked at slice 19)

| Concern | Pick | Why |
| --- | --- | --- |
| **STT** (speech → text) | Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) | Browser-native, free, no network round-trip, works offline on most modern browsers. No backend dep. Fallback: feature-detection + `disabled-with-tooltip`. |
| **TTS** (text → speech) | OpenAI TTS via the existing AI SDK pattern | Cheap (`tts-1` ≈ $15 / M chars), high quality, streaming-friendly. Wrap behind `backend/src/agent/tts.ts` and `frontend/src/lib/tts.ts` so swapping providers (ElevenLabs, Google, etc.) is a one-file change. Honors the `feedback_avoid_provider_lockin.md` rule. |
| **Audio container** | `audio/mpeg` (mp3) | Universal browser support. Stream-friendly via `Response.body` chunks; the `<audio>` element happily plays a Blob URL. |
| **Cache** | `Map<messageId, BlobURL>` in a Zustand-style store *or* a custom `useTts` hook | Avoid re-fetching the same response's audio. Eviction = page reload. |

Confirmation question ([§3.0 below](#30-decisions-to-lock-at-slice-19-start)) — the implementer can override at slice 19 if a different STT/TTS approach is preferred.

---

## 3. Architecture

### 3.0 Decisions to lock at slice 19 start

Open a single bundled `AskUserQuestion` covering all four; default to the recommendations.

1. **STT** — Web Speech API (browser-native) vs server-side Whisper. Recommend Web Speech.
2. **TTS provider** — OpenAI TTS vs ElevenLabs vs Google. Recommend OpenAI.
3. **Auto-play scope** — every settled response (TTS toggle on) vs manual-only. Recommend the toggle behavior the design already implies (`ttsOn` prop on `<Composer>`).
4. **Audio container** — `audio/mpeg` vs `audio/opus` vs `audio/wav`. Recommend `audio/mpeg`.

### 3.1 Backend additions

**One new route**: `POST /api/tts`.

```ts
// Request
{
  text: string,            // required, ≤ 4096 chars
  voice?: string,          // optional, defaults to env OPENAI_TTS_VOICE
  format?: 'mp3' | 'opus', // optional, defaults to mp3
  // No conversationId — TTS is stateless. Caching lives in the frontend.
}

// Response
//  Content-Type: audio/mpeg
//  X-Request-Id: <ulid>     ← carry-over from Phase 1 logging convention
//  Body: <audio bytes>
```

Errors follow the §3.4 envelope from the archived backend spec:

| HTTP | `error.code` | When |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | text empty / >4096 chars / unknown voice / unknown format |
| 429 | `RATE_LIMITED` | upstream provider 429 (mirrors §3.4 reservation) |
| 502 | `UPSTREAM_ERROR` | provider 5xx |
| 504 | `UPSTREAM_TIMEOUT` | provider exceeded `TTS_TIMEOUT_MS` |
| 500 | `INTERNAL` | anything else |

**New env (added to `.env.example`):**

```
# REQUIRED for Phase 3 TTS
OPENAI_API_KEY=
OPENAI_TTS_MODEL=tts-1
OPENAI_TTS_VOICE=alloy        # alloy | echo | fable | onyx | nova | shimmer
TTS_TIMEOUT_MS=15000
TTS_MAX_INPUT_CHARS=4096
```

**Files to add:**

| Path | Purpose |
| --- | --- |
| `backend/src/agent/tts.ts` | provider facade — `synthesize({ text, voice, format })` returns `Response` body or `Buffer` |
| `backend/src/routes/tts.ts` | Hono route mounted at `POST /api/tts` |
| `backend/tests/routes/tts.test.ts` | per-error-code coverage + happy path with stubbed provider |
| `backend/.env.example` | the new vars listed above |

### 3.2 Frontend additions

**New components:**
- `frontend/src/components/AudioPlayer.tsx` — port from `design/project/components.jsx:393`. Two variants: `compact` (next to `<MessageFooter>`) and `full` (modal / detail). Controlled props: `playing`, `elapsed`, `total`, `onPlayPause`, `onSeek`. Phase 2 already styled `.rx-audio*` and `.rx-audio--compact|--full` in `components.css`.

**New hooks:**
- `frontend/src/hooks/useSpeechRecognition.ts` — wraps `SpeechRecognition`. Returns `{ supported, recording, transcript, denied, start, stop, error }`. Mock-friendly for tests via `vi.spyOn(window, 'SpeechRecognition')`.
- `frontend/src/hooks/useTts.ts` — given `{ messageId, text }` returns `{ status: 'idle' | 'fetching' | 'ready' | 'error', audioUrl?, error?, fetch() }`. Internal cache keyed by `messageId`. On unmount, `URL.revokeObjectURL` to free the Blob.

**New lib:**
- `frontend/src/lib/tts.ts` — `fetchTts(text, opts?): Promise<Blob>`. Wraps `fetch('/api/tts', …)` with the same `ApiError` envelope handling as `lib/api.ts`. Thin facade — provider-neutral on the frontend side.

**Component changes (Phase 2 surfaces — minimal edits):**
- `frontend/src/components/Composer.tsx` — drop `disabled` from mic + TTS; wire to `useSpeechRecognition` + a new `ttsOn` controlled prop. Recording / denied states already designed in `components.jsx:313-389`.
- `frontend/src/components/AssistantMessage.tsx` — when `ttsOn` and `phase === 'done'`, mount `<AudioPlayer>` next to `<MessageFooter>`. The player auto-plays when `useTts` resolves.

### 3.3 Frontend state machine — `useSpeechRecognition`

```ts
type SpeechRecognitionState =
  | { phase: 'idle' }
  | { phase: 'unsupported' }                  // browser doesn't expose SpeechRecognition
  | { phase: 'denied' }                       // user blocked the mic
  | { phase: 'recording'; transcript: string }
  | { phase: 'error'; message: string }       // network / no-speech / aborted
```

**Transitions:**
- `idle → recording` on `start()`. Initializes `SpeechRecognition`, `recognition.continuous = false`, `recognition.interimResults = true`. Listens for `result`, `error`, `end` events.
- `recording → idle` on `stop()` (user tap) or `end` event. Final transcript is appended to the composer draft via the consumer's `onTranscript` callback.
- `* → denied` on `error.error === 'not-allowed' | 'service-not-allowed'`.
- `* → unsupported` if `window.SpeechRecognition || window.webkitSpeechRecognition` is undefined at hook init.

### 3.4 Frontend state machine — `useTts`

```ts
type TtsState =
  | { status: 'idle' }
  | { status: 'fetching' }
  | { status: 'ready'; audioUrl: string }     // Blob URL, revoked on unmount
  | { status: 'error'; code: ErrorCode; message: string }
```

Cache strategy: a module-level `Map<messageId, Promise<Blob>>` so two consumers asking for the same message's audio share one fetch. Cache survives route changes within the SPA but resets on full reload.

### 3.5 TTS auto-play UX

- Composer's TTS toggle (`ttsOn`) is persisted in localStorage — same pattern as `useTheme`.
- When `phase === 'done'` arrives for a turn AND `ttsOn` is true:
  - `useTts.fetch()` fires for the assistant's full text.
  - Once `status === 'ready'`, the `<AudioPlayer compact playing />` mounts and starts playback.
- A historical-only path (toggling TTS on while viewing a `/c/:id` page) lazy-fetches per assistant message on demand — manual play button click.

### 3.6 Wiring layers (delta from Phase 2 §3.3)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ChatPage                                                            │
│   ├─▶ Composer ── onSubmit ──┐    + onTranscript(text)               │
│   │     │                    │      from useSpeechRecognition        │
│   │     │  mic + TTS now active                                      │
│   │     │                                                            │
│   ├─▶ AssistantMessage                                              │
│   │     ├─▶ ReasoningPanel / ToolCalls / AnswerBody / MessageFooter  │
│   │     └─▶ AudioPlayer (when ttsOn && phase=done)                   │
│   │           └─▶ useTts(messageId, text)                            │
│   │                  └─▶ POST /api/tts → Blob URL                    │
│   └─▶ …                                                              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Slice plan (TDD-driven, per the project pause-for-review discipline)

Slice numbering continues from Phase 2 (slice 18). Each slice ends with **green tests + commit + pause for user review**.

### Slice 19 — Backend `/api/tts` (provider facade + Hono route)

**Tests first** —
- `backend/tests/routes/tts.test.ts`: happy path (stubbed provider returns audio Buffer, response is `audio/mpeg`); INVALID_INPUT for empty / 4097-char / unknown voice; UPSTREAM_TIMEOUT (provider hangs, `TTS_TIMEOUT_MS=50`); UPSTREAM_ERROR (provider 500); RATE_LIMITED (provider 429).
- `backend/tests/agent/tts.test.ts`: facade unit tests — env-driven voice / model defaults; format param.

**Impl** — `backend/src/agent/tts.ts`, `backend/src/routes/tts.ts`, mount in `src/index.ts`. Add env vars to `lib/env.ts` + `.env.example`. Wire pino logging at the same layer pattern (`http | service | tool`).

**DoD** — `bun test` green; `curl -X POST http://localhost:8787/api/tts -H 'content-type: application/json' -d '{"text":"hello"}' --output hello.mp3` produces a playable audio file.

### Slice 20 — `useSpeechRecognition` + Composer mic wiring

**Tests first** — `tests/hooks/useSpeechRecognition.test.ts`: happy path (start → recording → result event → idle with transcript); permission denied; unsupported (delete the global before mount); error event; concurrent start() is a no-op. Mocks `window.SpeechRecognition` via Vitest spies. Plus `tests/components/Composer.recording.test.tsx`: clicking mic toggles state and forwards transcripts via `onTranscript`.

**Impl** — `src/hooks/useSpeechRecognition.ts` per §3.3 state machine; `src/components/Composer.tsx` lifts the `disabled` from the mic, swaps the icon between `Mic` (idle) / `Stop` (recording) / `Lock` (denied) / `MicOff` (unsupported). Tooltip copy updates per state. Recording state pulses the `.rx-composer__recdot` (already styled).

**DoD** — Live: tapping mic in Chrome on macOS captures speech, fills the textarea. Denied: blocking permission shows the design's banner copy "Microphone permission denied. Enable mic access in browser settings."

### Slice 21 — `<AudioPlayer>` port + `useTts` hook

**Tests first** — `tests/components/AudioPlayer.test.tsx`: compact + full variants render the play/pause control, time labels, scrub bar; `playing=false` swaps the icon; `elapsed/total` updates fill width. `tests/hooks/useTts.test.ts`: cache hit dedupes a second fetch; ApiError surfaces in state.code / state.message; URL.revokeObjectURL fires on unmount.

**Impl** — `src/components/AudioPlayer.tsx` ported from the design (lines 393-422 of `design/project/components.jsx`); `src/hooks/useTts.ts`; `src/lib/tts.ts`. No JSX changes to `<AssistantMessage>` yet — that's slice 22.

**DoD** — `<AudioPlayer>` renders at all states in the dev gallery (`/__components`). `useTts` round-trips against an MSW-mocked `/api/tts` returning a fake Blob.

### Slice 22 — TTS toggle in Composer + auto-play on settle

**Tests first** — `tests/integration/tts-autoplay.test.tsx`: with `ttsOn` true, completing a stream triggers a `POST /api/tts` (MSW) and mounts `<AudioPlayer compact />` next to the assistant footer; with `ttsOn` false, no fetch fires. `tests/hooks/useTts.persistence.test.ts`: TTS toggle persists in localStorage.

**Impl** — `<Composer>` exposes `ttsOn` as a controlled prop (lift state to `ChatPage`); persists via a tiny `useTtsPreference` hook; `<AssistantMessage>` mounts `<AudioPlayer>` + `useTts` when `phase === 'done'` AND `ttsOn` is true.

**DoD** — Live: toggle TTS on in the composer, send a healthcare prompt, the answer streams, then the AudioPlayer appears and starts playing automatically. Toggling off mid-playback stops the audio.

### Slice 23 — Polish + Phase 3 closure

**Tests first** — Mobile breakpoint sanity (Composer mic button stays tappable with 44×44 minimum). Reduced-motion: AudioPlayer's progress bar doesn't animate when `prefers-reduced-motion`. Tab-trap: mic + TTS now reachable via keyboard.

**Impl** — README updates (demo script extended with the voice steps); a final eyeball on Safari (Web Speech API has Safari-specific quirks: `interimResults` events fire less often, requires explicit user gesture to start). Update CLAUDE.md to mark Phase 3 closed and pivot to Phase 4 (Docker + CI).

**DoD** — Recording-ready continuous demo from blank state → text chat → voice in → voice out, no UI fights.

---

## 5. Failure modes (UI-side)

| ID | Trigger | Symptom | Mitigation |
| --- | --- | --- | --- |
| V-F-1 | User denies mic permission | Browser fires `error.error === 'not-allowed'` | `<Composer>` shows the design's S-5 banner ("Microphone permission denied…"), mic icon switches to `Lock`, button stays disabled until user re-grants. |
| V-F-2 | Browser doesn't expose Web Speech (e.g. Firefox without flag) | Mic button must not throw on click | Hook's `phase: 'unsupported'` state — mic stays `disabled` with `title="Voice input not supported in this browser"`. |
| V-F-3 | Network drops mid-recognition | `error.error === 'network'` | Toast + return to `idle`; partial transcript discarded. |
| V-F-4 | TTS request 4xx/5xx | `ApiError` surfaces in `useTts.state.code` | `<AudioPlayer>` shows an inline error pill; manual retry via play-button click. |
| V-F-5 | TTS audio fails to play (codec issue) | `<audio>` element fires `error` event | Toast "Couldn't play audio in this browser"; fall back to text-only render. |
| V-F-6 | Long assistant message exceeds `TTS_MAX_INPUT_CHARS` (4096) | Backend returns 400 INVALID_INPUT | Frontend chunks the text or shows a polite "This response is too long for spoken playback" pill. |
| V-F-7 | User toggles TTS off mid-fetch | Fetch must abort cleanly | `useTts.fetch()` honors an AbortController stored in state; cleanup on toggle-off. |
| V-F-8 | Two messages auto-play at the same time | Audio overlap | A simple "current player" selector in the Zustand store (or context) — only one `<AudioPlayer>` is `playing` at a time; auto-play of a new turn pauses the previous. |

---

## 6. Out of scope (Phase 3)

- **Wake-word / "Hey Rx" hotword** — manual mic press only.
- **Multi-language STT/TTS** — `lang="en-US"` for both. Cross-locale support deferred.
- **Voice-only mode** (no textarea visible) — keyboard input remains primary; voice is additive.
- **Voice cloning / custom voices** — use the provider's stock voice list.
- **Saving the audio blob to the backend** — TTS is regenerated on demand from text. Backend stays voice-state-free; only the new `/api/tts` route changes.
- **Resuming TTS playback across reloads** — Blob URLs are page-scoped; reload re-fetches if the user replays.
- **Phase 4** — Docker compose + CI. Separate spec.

---

## 7. Sign-off (decisions log)

| Axis | Decision | Locked at |
| --- | --- | --- |
| STT | Web Speech API (browser-native) | Slice 19 `AskUserQuestion` |
| TTS provider | OpenAI TTS via thin facade | Slice 19 `AskUserQuestion` |
| Audio format | `audio/mpeg` | Slice 19 `AskUserQuestion` |
| Auto-play | `ttsOn` toggle in composer; persists in localStorage | Slice 22 |
| Concurrency | Single global "now playing" — new auto-play pauses prior | Slice 22 |
| Cache | Module-level `Map<messageId, Promise<Blob>>`; cleared on full reload | Slice 21 |
| Backend route | `POST /api/tts` returning `audio/mpeg`; `text/plain` errors via the existing `{error: {code, message}}` envelope | Slice 19 |
| Failure-mode envelope | Mirrors backend §3.4 codes; UI extends with `STT_DENIED`, `STT_UNSUPPORTED`, `STT_NETWORK` | §5 above |

Phase 3 closes when all DoDs above are green and the recording can flow uninterrupted from voice-in through voice-out without manual fallbacks.
