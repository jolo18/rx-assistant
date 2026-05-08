/**
 * Web Speech Synthesis state machine — TTS side of Phase 3.
 *
 * Wraps `window.speechSynthesis` with a per-message playback controller.
 * Long text is chunked (`lib/tts.ts`) and queued via `onend → speak(next)`
 * so Chrome's ~15s utterance cap doesn't truncate long answers. Single
 * global "now-speaking" — calling `play()` cancels any prior utterance
 * before starting a new one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ErrorCode } from '../lib/chat-events'
import { chunkText, createUtterance, getSynthesis, isSupported } from '../lib/tts'

export type TtsState =
  | { status: 'idle' }
  | { status: 'unsupported' }
  | { status: 'speaking'; charIndex: number; totalChars: number }
  | { status: 'paused'; charIndex: number; totalChars: number }
  | { status: 'error'; code: ErrorCode; message: string }

export type UseTtsResult = {
  state: TtsState
  play: (text: string) => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export function useTts(): UseTtsResult {
  const [state, setState] = useState<TtsState>(() =>
    isSupported() ? { status: 'idle' } : { status: 'unsupported' },
  )
  const stateRef = useRef(state)
  stateRef.current = state

  // Track the in-flight chunked playback so `play()` can cancel it cleanly.
  const sessionRef = useRef<{ active: boolean }>({ active: false })

  const play = useCallback((text: string) => {
    if (stateRef.current.status === 'unsupported') return
    const synth = getSynthesis()
    if (!synth) {
      setState({ status: 'unsupported' })
      return
    }

    const trimmed = text.trim()
    if (trimmed.length === 0) return

    // Cancel any prior in-flight session so the single-utterance invariant
    // holds. The previous session's onend will fire but its `.active = false`
    // flag prevents it from advancing or transitioning state.
    if (sessionRef.current.active) {
      sessionRef.current.active = false
    }
    synth.cancel()

    const chunks = chunkText(trimmed)
    const totalChars = chunks.reduce((sum, c) => sum + c.length, 0)
    const session = { active: true }
    sessionRef.current = session

    let chunkIdx = 0
    let charsBefore = 0

    const speakNext = () => {
      if (!session.active) return
      if (chunkIdx >= chunks.length) {
        setState({ status: 'idle' })
        session.active = false
        return
      }
      const chunk = chunks[chunkIdx]!
      const utt = createUtterance(chunk)
      utt.onboundary = (e) => {
        if (!session.active) return
        if (e.name !== 'word') return
        const charIndex = Math.min(charsBefore + e.charIndex, totalChars)
        setState({ status: 'speaking', charIndex, totalChars })
      }
      utt.onend = () => {
        if (!session.active) return
        charsBefore += chunk.length
        chunkIdx += 1
        speakNext()
      }
      utt.onerror = (e) => {
        if (!session.active) return
        session.active = false
        const errorEvent = e as { error?: string }
        setState({
          status: 'error',
          code: 'INTERNAL',
          message: errorEvent.error ?? 'tts error',
        })
      }
      synth.speak(utt)
    }

    setState({ status: 'speaking', charIndex: 0, totalChars })
    speakNext()
  }, [])

  const pause = useCallback(() => {
    const synth = getSynthesis()
    if (!synth) return
    synth.pause()
    setState((s) =>
      s.status === 'speaking'
        ? { status: 'paused', charIndex: s.charIndex, totalChars: s.totalChars }
        : s,
    )
  }, [])

  const resume = useCallback(() => {
    const synth = getSynthesis()
    if (!synth) return
    synth.resume()
    setState((s) =>
      s.status === 'paused'
        ? { status: 'speaking', charIndex: s.charIndex, totalChars: s.totalChars }
        : s,
    )
  }, [])

  const stop = useCallback(() => {
    const synth = getSynthesis()
    if (!synth) return
    sessionRef.current.active = false
    synth.cancel()
    setState({ status: 'idle' })
  }, [])

  // Cleanup on unmount — cancel any in-flight playback so it doesn't keep
  // talking after the component is gone.
  useEffect(() => {
    return () => {
      sessionRef.current.active = false
      const synth = getSynthesis()
      synth?.cancel()
    }
  }, [])

  return { state, play, pause, resume, stop }
}
