# Phase 3 — Voice (mic input + TTS output)

> **Phase 1 reference:** `specs/archive/phase-1-agentic-streaming-backend.md` (closed at `62f81f3`).
> **Phase 2 reference:** `specs/archive/phase-2-frontend.md` (closed at `2a680b2`). 175 / 175 frontend tests, 170 / 170 backend.
> **Pre-existing voice surface:** `<Composer>` mic + TTS render `disabled` with native `title="Voice input arrives in Phase 3"` / `title="Spoken replies arrive in Phase 3"`; the design source's `<AudioPlayer>` is fully styled (`.rx-audio*` classes) but currently unmounted. Phase 3's job is to lift the `disabled` and wire the runtimes — no other Phase 2 refactors required.

---

## 1. Goal & success criteria

Add **bidirectional voice** to the chat:

- **Voice in** — user holds (or taps) the composer mic, speaks a question, sees the recognized transcript in the textarea, taps Send (or auto-submits).
- **Voice out** — settled assistant responses can be played back as audio. A TTS toggle in the composer picks between text-only ("off") and "auto-play on settle" ("on"); each `<AudioPlayer>` next to a message also has a manual play / pause control.

End-of-phase ships when:

1. `cd backend && bun test` — green. Phase 3 ships **zero backend changes** (see §3.1), so the count stays at 170 / 170.
2. `cd frontend && bun run test` — green, including STT hook tests + AudioPlayer tests + integration tests for the auto-play path.
3. Live demo: speak a healthcare prompt → the textarea fills with the transcript → submit → the answer streams + auto-plays via `<AudioPlayer>`.
4. Mic button shows a permission-denied state (per the design's S-5 screen) when the user blocks microphone access.
5. Browser unsupported (Firefox without Web Speech, etc.) → mic stays `disabled` with copy "Voice input not supported in this browser." TTS likewise degrades gracefully.
6. Recording-ready: a continuous narrated demo can show mic → answer → playback without fighting the UI.

---

## 2. Provider choices (locked)

| Concern | Pick | Why |
| --- | --- | --- |
| **STT** (speech → text) | Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) | Browser-native, free, no network round-trip, works offline on most modern browsers. No backend dep. Fallback: feature-detection + `disabled-with-tooltip`. |
| **TTS** (text → speech) | **Web Speech Synthesis API** (`SpeechSynthesisUtterance`) | Browser-native, free, no API key, works offline using OS voices. **Symmetrical with STT** — one surface area, no backend route, no audio container, no storage decisions. Trade-off accepted: voice quality is OS-dependent (macOS/iOS voices are good; Windows/Linux defaults are rougher). |
| **Storage** | None — frontend in-memory state only | `SpeechSynthesisUtterance` plays directly through the OS audio stack; no Blob is ever produced. The "cache" from earlier drafts dissolves into per-message playback state in `useTts`. Reload re-generates. |
| **Backend** | Untouched | Phase 3 is **purely frontend**. No new routes, no new env vars, no schema changes. |

---

## 3. Architecture

### 3.0 Decisions to lock at slice 19 start

Open a single bundled `AskUserQuestion` covering these three; default to the recommendations.

1. **STT** — Web Speech API (browser-native) vs server-side Whisper. Recommend Web Speech (already locked above).
2. **TTS** — Web Speech Synthesis (browser-native) vs server-side (Piper / OpenAI). Recommend Web Speech Synthesis (already locked above).
3. **Auto-play scope** — every settled response (TTS toggle on) vs manual-only. Recommend the toggle behavior the design already implies (`ttsOn` prop on `<Composer>`).

### 3.1 Backend additions

**None.** With Web Speech Synthesis on the client, there's no `/api/tts` route to add and no provider key to plumb. `backend/` stays at 170 / 170.

### 3.2 Frontend additions

**New components:**
- `frontend/src/components/AudioPlayer.tsx` — port from `design/project/components.jsx:393`. Two variants: `compact` (next to `<MessageFooter>`) and `full` (modal / detail). Controlled props: `playing`, `paused`, `progress` (0..1), `onPlayPause`. Phase 2 already styled `.rx-audio*` and `.rx-audio--compact|--full` in `components.css`. **Limitation under Web Speech Synthesis**: `SpeechSynthesisUtterance` does not expose duration; we approximate progress via the `boundary` event's `charIndex` (progress ≈ `charIndex / text.length`). The full-variant scrub bar becomes a read-only progress indicator — no seek.

**New hooks:**
- `frontend/src/hooks/useSpeechRecognition.ts` — wraps `SpeechRecognition`. Returns `{ supported, recording, transcript, denied, start, stop, error }`. Mock-friendly for tests via `vi.spyOn(window, 'SpeechRecognition')`.
- `frontend/src/hooks/useTts.ts` — wraps `window.speechSynthesis` + a per-message `SpeechSynthesisUtterance`. Returns `{ status, progress, play, pause, resume, stop }`. Single global "now-speaking" message — starting playback on a new message cancels the previous one. Internal: a tiny module-level singleton tracks the active utterance so multiple components (the `compact` AudioPlayer next to a turn + a hypothetical `full` variant later) stay in sync.

**New lib:**
- `frontend/src/lib/tts.ts` — thin facade around `speechSynthesis`. Exposes `speak(text, opts?)`, `cancel()`, `pause()`, `resume()`, plus a `getVoice(prefs?)` helper that picks a sensible default voice from `speechSynthesis.getVoices()`. Provider-neutral on intent (per `feedback_avoid_provider_lockin`) — if a future phase swaps to a server route this is the only file the consumer touches.

**Component changes (Phase 2 surfaces — minimal edits):**
- `frontend/src/components/Composer.tsx` — drop `disabled` from mic + TTS; wire mic to `useSpeechRecognition`; wire TTS toggle to a new `ttsOn` controlled prop. Recording / denied states already designed in `components.jsx:313-389`.
- `frontend/src/components/AssistantMessage.tsx` — when `ttsOn` and `phase === 'done'`, mount `<AudioPlayer compact />` next to `<MessageFooter>`. The player auto-plays via `useTts.play()` once mounted.

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
  | { status: 'unsupported' }                  // window.speechSynthesis missing
  | { status: 'speaking'; charIndex: number }  // updated via the boundary event
  | { status: 'paused';   charIndex: number }
  | { status: 'error'; code: ErrorCode; message: string }
```

**Transitions:**
- `idle → speaking` on `play(text)`. Internally constructs a `SpeechSynthesisUtterance(text)`, attaches `onboundary` (advances `charIndex`), `onend` (→ `idle`), `onerror` (→ `error`), then calls `speechSynthesis.speak(utt)`. If `speechSynthesis.speaking` is true on entry, calls `cancel()` first so the global "now-speaking" invariant holds (one utterance at a time).
- `speaking → paused` on `pause()` → `speechSynthesis.pause()`.
- `paused → speaking` on `resume()` → `speechSynthesis.resume()`.
- `* → idle` on `stop()` → `speechSynthesis.cancel()`.
- `* → unsupported` if `typeof speechSynthesis === 'undefined'` at hook init.
- `* → error` on `utt.onerror`. The `event.error` string maps to a UI ErrorCode (e.g. `synthesis-failed` → `INTERNAL`, `language-unavailable` → `INVALID_INPUT`, `audio-busy` → `NETWORK_ERROR` semantics-wise).

`progress` (0..1) is computed live as `charIndex / text.length`. Web Speech Synthesis does not expose a true duration, so the AudioPlayer's progress bar is approximate — accurate on word boundaries, not character-by-character.

### 3.5 TTS auto-play UX

- Composer's TTS toggle (`ttsOn`) is persisted in localStorage — same pattern as `useTheme`.
- When `phase === 'done'` arrives for a turn AND `ttsOn` is true:
  - The `<AudioPlayer compact />` mounts inside `<AssistantMessage>` and immediately calls `useTts.play(assistant.text)`.
  - Subsequent settled turns cancel any in-flight playback before starting (single-utterance invariant in §3.4).
- A historical-only path (toggling TTS on while viewing a `/c/:id` page) lazy-plays per assistant message on demand — manual play button click only; no auto-play retroactively.

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
│   │           └─▶ useTts(text)                                       │
│   │                  └─▶ speechSynthesis.speak(utterance)            │
│   └─▶ …                                                              │
└──────────────────────────────────────────────────────────────────────┘
```

No network arrow on the TTS path — the browser plays through the OS audio stack directly.

---

## 4. Slice plan (TDD-driven, per the project pause-for-review discipline)

Slice numbering continues from Phase 2 (slice 18). **Four slices** (the original draft's slice 19 backend route is gone). Each slice ends with **green tests + commit + pause for user review**.

### Slice 19 — `useSpeechRecognition` + Composer mic wiring

**Tests first** — `tests/hooks/useSpeechRecognition.test.ts`: happy path (start → recording → result event → idle with transcript); permission denied; unsupported (delete the global before mount); error event; concurrent start() is a no-op. Mocks `window.SpeechRecognition` via Vitest spies. Plus `tests/components/Composer.recording.test.tsx`: clicking mic toggles state and forwards transcripts via `onTranscript`.

**Impl** — `src/hooks/useSpeechRecognition.ts` per §3.3 state machine; `src/components/Composer.tsx` lifts the `disabled` from the mic, swaps the icon between `Mic` (idle) / `Stop` (recording) / `Lock` (denied) / `MicOff` (unsupported). Tooltip copy updates per state. Recording state pulses the `.rx-composer__recdot` (already styled).

**DoD** — Live: tapping mic in Chrome on macOS captures speech, fills the textarea. Denied: blocking permission shows the design's banner copy "Microphone permission denied. Enable mic access in browser settings."

### Slice 20 — `<AudioPlayer>` port + `useTts` hook (Web Speech Synthesis)

**Tests first** — `tests/components/AudioPlayer.test.tsx`: compact + full variants render the play/pause control and progress indicator; `playing=false` swaps the icon; `progress` updates fill width; the full variant's scrub bar is read-only (no `onSeek` exposed). `tests/hooks/useTts.test.ts`: state transitions per §3.4 with a stubbed `window.speechSynthesis`; unsupported path; calling `play()` twice cancels the first utterance; pause / resume / stop semantics; boundary event advances charIndex.

**Impl** — `src/components/AudioPlayer.tsx` ported from the design (lines 393-422 of `design/project/components.jsx`); `src/hooks/useTts.ts`; `src/lib/tts.ts` facade. No JSX changes to `<AssistantMessage>` yet — that's slice 21. Add `<AudioPlayer>` to the dev gallery's component list so all states are visible.

**DoD** — `<AudioPlayer>` renders at all states in `/__components`. `useTts` round-trips against a Vitest-stubbed `speechSynthesis`. Manually clicking play in the gallery actually speaks the text via the browser's TTS engine.

### Slice 21 — TTS toggle in Composer + auto-play on settle

**Tests first** — `tests/integration/tts-autoplay.test.tsx`: with `ttsOn` true, completing a stream mounts `<AudioPlayer compact />` next to the assistant footer and calls `speechSynthesis.speak`; with `ttsOn` false, no utterance fires. `tests/hooks/useTtsPreference.test.ts`: TTS toggle persists in localStorage. `tests/components/Composer.tts-toggle.test.tsx`: clicking the TTS button flips `ttsOn` and forwards the change.

**Impl** — `<Composer>` exposes `ttsOn` as a controlled prop (lift state to `ChatPage`); persists via a tiny `useTtsPreference` hook; `<AssistantMessage>` mounts `<AudioPlayer>` + `useTts` when `phase === 'done'` AND `ttsOn` is true. Single-utterance invariant in §3.4 means a new turn auto-cancels the previous turn's playback.

**DoD** — Live: toggle TTS on in the composer, send a healthcare prompt, the answer streams, then the AudioPlayer appears and starts playing automatically. Toggling off mid-playback stops the audio. Sending another prompt cancels the in-flight playback before the new one auto-plays.

### Slice 22 — Polish + Phase 3 closure

**Tests first** — Mobile breakpoint sanity (Composer mic button stays tappable with 44×44 minimum). Reduced-motion: AudioPlayer's progress bar doesn't animate when `prefers-reduced-motion`. Tab-trap: mic + TTS now reachable via keyboard. Browser-quirk smoke: macOS Safari requires explicit user gesture before `speechSynthesis.speak` works the *first* time per page.

**Impl** — README updates (demo script extended with the voice steps). Live eyeball pass on Safari (Web Speech API has Safari-specific quirks) and at least one Firefox check (where TTS works but STT may not, exercising the "unsupported" path). Update CLAUDE.md to mark Phase 3 closed and pivot to Phase 4 (Docker + CI).

**DoD** — Recording-ready continuous demo from blank state → text chat → voice in → voice out, no UI fights. All Phase 3 acceptance items in §1 above tick green.

---

## 5. Failure modes (UI-side)

| ID | Trigger | Symptom | Mitigation |
| --- | --- | --- | --- |
| V-F-1 | User denies mic permission | Browser fires `error.error === 'not-allowed'` | `<Composer>` shows the design's S-5 banner ("Microphone permission denied…"), mic icon switches to `Lock`, button stays disabled until user re-grants. |
| V-F-2 | Browser doesn't expose Web Speech (Firefox without flag, older Safari) | Mic button must not throw on click | Hook's `phase: 'unsupported'` state — mic stays `disabled` with `title="Voice input not supported in this browser"`. |
| V-F-3 | Browser doesn't expose `speechSynthesis` (rare; some headless / minimal browsers) | TTS toggle must not throw | Hook's `status: 'unsupported'` state — TTS button stays `disabled` with `title="Spoken replies not supported in this browser"`. |
| V-F-4 | OS has no installed TTS voices | `getVoices()` returns `[]`; `speak()` is a silent no-op | Detect at first `play()` call — if `getVoices()` is empty after the `voiceschanged` event fires, set `status: 'error'` with code `INVALID_INPUT` and copy "No system voices available." |
| V-F-5 | Long assistant message (~5000+ chars) | Some browsers truncate; Chrome has a known ~15s utterance cut-off bug | Chunk the text into ~500-char paragraphs and queue them sequentially via `onend → speak(next)`. Documented in `useTts`. |
| V-F-6 | User toggles TTS off mid-utterance | Must abort cleanly | `useTts.stop()` → `speechSynthesis.cancel()`. |
| V-F-7 | Two assistant turns settle in quick succession | Audio overlap | Single-utterance invariant in §3.4 — a fresh `play()` calls `cancel()` first. |
| V-F-8 | iOS Safari first-load: TTS won't fire without user gesture | Auto-play on settle silently fails | First TTS call requires the user to have interacted with the page (clicking the TTS toggle counts). Documented in the README; not worked around in code. |
| V-F-9 | Network / STT error events | `error.error === 'network' \| 'aborted' \| 'no-speech'` | Toast + return to `idle`; partial transcript discarded. |

---

## 6. Out of scope (Phase 3)

- **Wake-word / "Hey Rx" hotword** — manual mic press only.
- **Multi-language STT/TTS** — `lang="en-US"` for both. Cross-locale support deferred.
- **Voice-only mode** (no textarea visible) — keyboard input remains primary; voice is additive.
- **Voice cloning / custom voices** — use whatever voices the OS exposes via `speechSynthesis.getVoices()`.
- **Backend persistence of synthesized audio** — Web Speech Synthesis doesn't expose a Blob; nothing to store. Per-reload re-generation is accepted (it's instant on the client anyway).
- **Voice consistency across devices** — accepted limitation. macOS / iOS voices are excellent; Linux / Windows defaults are rougher. Demo should be recorded on macOS for the cleanest sound.
- **Resuming TTS playback across reloads** — utterance state is page-scoped; reload starts from idle.
- **Server-side TTS fallback** — if the browser can't synthesize, the user sees a graceful error pill rather than a server round-trip.
- **Phase 4** — Docker compose + CI. Separate spec.

---

## 7. Sign-off (decisions log)

| Axis | Decision | Locked at |
| --- | --- | --- |
| STT | Web Speech API (browser-native) | Phase 3 spec entry |
| TTS | Web Speech Synthesis API (browser-native) | Phase 3 spec entry — symmetric with STT, no infra |
| Storage | None — in-memory state per message; reload re-generates | Phase 3 spec entry |
| Backend | No Phase 3 changes | Phase 3 spec entry |
| Auto-play | `ttsOn` toggle in composer; persists in localStorage | Slice 21 |
| Concurrency | Single global "now speaking" — new utterance cancels prior | Slice 20 |
| AudioPlayer scrub | Read-only progress (no seek) — Web Speech Synthesis doesn't expose duration | Slice 20 |
| Failure-mode envelope | Mirrors backend §3.4 codes; UI extends with `STT_DENIED`, `STT_UNSUPPORTED`, `TTS_UNSUPPORTED`, `TTS_NO_VOICES`, `STT_NETWORK` | §5 above |

Phase 3 closes when all DoDs above are green and the recording flows uninterrupted from voice-in through voice-out without manual fallbacks.
