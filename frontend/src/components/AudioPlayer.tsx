/**
 * Audio player — visual surface for TTS playback. Ported from
 * design/project/components.jsx:393.
 *
 * Limitation under Web Speech Synthesis: SpeechSynthesisUtterance does not
 * expose a duration and you can't seek into it. Progress is fed in via the
 * `progress` prop (0..1) computed from `boundary` event's charIndex / total
 * chars. The full variant's bar is therefore a read-only progress indicator —
 * no thumb (it'd imply interactivity we can't deliver) and no time labels
 * (we don't know the duration).
 */

import { Pause, Play, Speaker } from './icons'

export type AudioPlayerVariant = 'compact' | 'full'

type AudioPlayerProps = {
  variant?: AudioPlayerVariant
  /** True while the utterance is actively being spoken. */
  playing?: boolean
  /** 0..1 — progress through the spoken text, computed from charIndex / totalChars. */
  progress?: number
  onPlayPause?: () => void
}

export function AudioPlayer({
  variant = 'compact',
  playing = true,
  progress = 0,
  onPlayPause,
}: AudioPlayerProps) {
  const pct = Math.max(0, Math.min(100, progress * 100))

  if (variant === 'compact') {
    return (
      <div className="rx-audio rx-audio--compact" role="group" aria-label="Spoken reply">
        <button
          type="button"
          className="rx-audio__pp"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={onPlayPause}
        >
          {playing ? (
            <Pause size={14} fill="currentColor" stroke="none" />
          ) : (
            <Play size={14} fill="currentColor" stroke="none" />
          )}
        </button>
        <div className="rx-audio__bar">
          <span className="rx-audio__fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  // Full variant: bar is a read-only progress indicator. No thumb, no time
  // labels — Web Speech Synthesis exposes neither duration nor seek.
  return (
    <div className="rx-audio rx-audio--full" role="group" aria-label="Spoken reply">
      <button
        type="button"
        className="rx-audio__pp"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={onPlayPause}
      >
        {playing ? (
          <Pause size={14} fill="currentColor" stroke="none" />
        ) : (
          <Play size={14} fill="currentColor" stroke="none" />
        )}
      </button>
      <div className="rx-audio__bar">
        <span className="rx-audio__fill" style={{ width: `${pct}%` }} />
      </div>
      <button type="button" className="rx-audio__vol" aria-label="Volume">
        <Speaker size={14} />
      </button>
    </div>
  )
}
