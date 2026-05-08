import type { KeyboardEvent } from 'react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { Lock, Mic, Send, SpeakerOff, Stop } from './icons'

export type ComposerPhase = 'idle' | 'submitting' | 'streaming' | 'done' | 'error'

type ComposerProps = {
  value: string
  onChange: (next: string) => void
  onSubmit: (text: string) => void
  phase?: ComposerPhase
  /** Visual focus class hint (the textarea owns real focus). */
  focused?: boolean
}

const TTS_TOOLTIP = 'Spoken replies arrive in Phase 3'

const MIC_TOOLTIPS = {
  idle: 'Voice input',
  recording: 'Stop recording',
  denied: 'Microphone permission denied — enable in browser settings',
  unsupported: 'Voice input not supported in this browser',
  error: 'Voice input failed — try again',
} as const

export function Composer({
  value,
  onChange,
  onSubmit,
  phase = 'idle',
  focused = false,
}: ComposerProps) {
  const submitting = phase === 'submitting'
  const streaming = phase === 'streaming'
  const locked = submitting || streaming
  const trimmed = value.trim()
  const canSubmit = trimmed.length > 0 && !locked

  const speech = useSpeechRecognition({
    onTranscript: (text) => {
      onChange(text)
    },
  })
  const recording = speech.state.phase === 'recording'
  const micDisabled =
    speech.state.phase === 'unsupported' || speech.state.phase === 'denied'
  const micTooltip = MIC_TOOLTIPS[speech.state.phase] ?? MIC_TOOLTIPS.idle

  function tryOnSubmit() {
    if (!canSubmit) return
    onSubmit(trimmed)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      tryOnSubmit()
    }
  }

  function toggleMic() {
    if (recording) speech.stop()
    else speech.start()
  }

  return (
    <div className={'rx-composer' + (focused ? ' is-focused' : '')}>
      <div className="rx-composer__inputwrap">
        <textarea
          className="rx-composer__input t-body-md"
          rows={1}
          value={value}
          placeholder="Ask about a medication or a symptom…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="rx-composer__actions">
          <button
            type="button"
            className={
              'rx-composer__btn rx-composer__mic' +
              (recording ? ' is-recording' : '') +
              (speech.state.phase === 'denied' ? ' is-denied' : '')
            }
            aria-label="Voice input"
            aria-pressed={recording}
            title={micTooltip}
            disabled={micDisabled}
            onClick={toggleMic}
          >
            {speech.state.phase === 'denied' ? (
              <Lock size={16} />
            ) : speech.state.phase === 'unsupported' ? (
              <Lock size={16} />
            ) : recording ? (
              <>
                <span className="rx-composer__recdot" aria-hidden="true" />
                <Stop size={14} />
              </>
            ) : (
              <Mic size={16} />
            )}
          </button>
          <button
            type="button"
            className="rx-composer__btn rx-composer__tts"
            aria-label="Spoken replies"
            title={TTS_TOOLTIP}
            disabled
          >
            <SpeakerOff size={16} />
          </button>
          <button
            type="button"
            className={'rx-composer__send' + (canSubmit ? ' is-active' : '')}
            disabled={!canSubmit}
            aria-label={locked ? 'Sending' : 'Send'}
            title="Send"
            onClick={tryOnSubmit}
          >
            {locked ? (
              <span className="rx-composer__spin" aria-hidden="true" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
      <p className="rx-composer__disclaimer t-caption">
        Informational only — not medical advice. Confirm anything important with a clinician.
      </p>
    </div>
  )
}
