import type { KeyboardEvent } from 'react'
import { Lock, Send, SpeakerOff } from './icons'

export type ComposerPhase = 'idle' | 'submitting' | 'streaming' | 'done' | 'error'

type ComposerProps = {
  value: string
  onChange: (next: string) => void
  onSubmit: (text: string) => void
  phase?: ComposerPhase
  /** Visual focus class hint (the textarea owns real focus). */
  focused?: boolean
}

const VOICE_TOOLTIP = 'Voice input arrives in Phase 3'
const TTS_TOOLTIP = 'Spoken replies arrive in Phase 3'

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
            className="rx-composer__btn rx-composer__mic is-denied"
            aria-label="Voice input"
            title={VOICE_TOOLTIP}
            disabled
          >
            <Lock size={16} />
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

