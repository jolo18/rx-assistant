/**
 * Web Speech API wrapper — STT side of Phase 3.
 *
 * Browser support is uneven: Chrome / Safari / Edge expose `SpeechRecognition`
 * (or `webkitSpeechRecognition`); Firefox does not by default. The hook
 * feature-detects on first render and surfaces an `unsupported` phase so the
 * Composer can keep the mic button `disabled` instead of crashing on click.
 *
 * Single-shot dictation: `continuous = false`, `interimResults = true`. The
 * browser auto-finalizes after silence; the user can also tap the mic again
 * to stop early. Final transcript fires `onTranscript` exactly once and the
 * hook returns to idle.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type SpeechRecognitionState =
  | { phase: 'idle' }
  | { phase: 'unsupported' }
  | { phase: 'denied' }
  | { phase: 'recording'; transcript: string }
  | { phase: 'error'; message: string }

export type UseSpeechRecognitionOptions = {
  /** Fired once when a final transcript arrives. */
  onTranscript?: (text: string) => void
  /** BCP-47 language tag. Defaults to en-US per spec §6 scope. */
  lang?: string
  /**
   * Auto-stop after this many milliseconds of silence (no `result` events).
   * Resets on every interim or final result. Default 5000.
   *
   * The Web Speech API itself uses `continuous = false` to mean "auto-stop
   * after the first end-of-speech," which Chrome interprets as a ~1–2 s
   * pause. Users with normal speaking pauses found that too aggressive — we
   * run with `continuous = true` and manage silence ourselves.
   */
  silenceTimeoutMs?: number
}

export type UseSpeechRecognitionResult = {
  state: SpeechRecognitionState
  start: () => void
  stop: () => void
}

// ── Minimal Web Speech API surface (TypeScript DOM lib doesn't ship it) ─────

type RecognitionResult = ArrayLike<{ transcript: string }> & {
  isFinal: boolean
  length: number
}
type RecognitionResultList = ArrayLike<RecognitionResult> & { length: number }
type RecognitionResultEvent = { results: RecognitionResultList; resultIndex?: number }
type RecognitionErrorEvent = { error: string; message?: string }

type RecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: ((e: Event) => void) | null
  onresult: ((e: RecognitionResultEvent) => void) | null
  onerror: ((e: RecognitionErrorEvent) => void) | null
  onend: ((e: Event) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type RecognitionCtor = new () => RecognitionLike

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSpeechRecognition(
  opts: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionResult {
  const { onTranscript, lang = 'en-US', silenceTimeoutMs = 5_000 } = opts

  const [state, setState] = useState<SpeechRecognitionState>(() =>
    getRecognitionCtor() ? { phase: 'idle' } : { phase: 'unsupported' },
  )
  const recRef = useRef<RecognitionLike | null>(null)
  const phaseRef = useRef<SpeechRecognitionState['phase']>(state.phase)
  phaseRef.current = state.phase
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const start = useCallback(() => {
    if (phaseRef.current === 'unsupported' || phaseRef.current === 'recording') return

    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setState({ phase: 'unsupported' })
      return
    }

    const rec = new Ctor()
    // `continuous = true` so the API itself doesn't auto-finalize on a short
    // pause. Silence is enforced manually via the timer below.
    rec.continuous = true
    rec.interimResults = true
    rec.lang = lang

    let finalTranscript = ''
    let silenceTimer: ReturnType<typeof setTimeout> | null = null

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => {
        // Stop gracefully — `onend` fires next, finalizes the transcript,
        // and resets state to idle.
        try {
          rec.stop()
        } catch {
          /* idempotent */
        }
      }, silenceTimeoutMs)
    }

    const clearSilenceTimer = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer)
        silenceTimer = null
      }
    }

    rec.onstart = () => {
      resetSilenceTimer()
      setState((s) => (s.phase === 'recording' ? s : { phase: 'recording', transcript: '' }))
    }
    rec.onresult = (e) => {
      resetSilenceTimer()
      // Web Speech API hands us the *cumulative* results array on every
      // event — `resultIndex` is the offset of the first new result since
      // the previous dispatch. Iterating from 0 instead would re-apply
      // every prior final result and triple-print the transcript.
      const startIdx = e.resultIndex ?? 0
      let interim = ''
      let newFinal = ''
      for (let i = startIdx; i < e.results.length; i++) {
        const r = e.results[i]!
        const text = r[0]?.transcript ?? ''
        if (r.isFinal) newFinal += text
        else interim += text
      }
      if (newFinal) finalTranscript += newFinal
      setState({ phase: 'recording', transcript: (finalTranscript + interim).trim() })
    }
    rec.onerror = (e) => {
      clearSilenceTimer()
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setState({ phase: 'denied' })
      } else {
        setState({ phase: 'error', message: e.error })
      }
    }
    rec.onend = () => {
      clearSilenceTimer()
      recRef.current = null
      const text = finalTranscript.trim()
      if (text.length > 0) {
        onTranscriptRef.current?.(text)
      }
      setState((s) => (s.phase === 'recording' ? { phase: 'idle' } : s))
    }

    try {
      rec.start()
    } catch {
      // start() can throw if the recognition is already running; bail.
      return
    }

    recRef.current = rec
    setState({ phase: 'recording', transcript: '' })
  }, [lang])

  const stop = useCallback(() => {
    recRef.current?.stop()
  }, [])

  useEffect(() => {
    return () => {
      recRef.current?.abort()
      recRef.current = null
    }
  }, [])

  return { state, start, stop }
}
