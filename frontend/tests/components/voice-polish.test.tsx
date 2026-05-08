/**
 * Slice 22 polish — class-level smoke tests for the voice surfaces.
 * Visual regression / device testing happens manually per the spec; these
 * assertions just pin the CSS hooks the design's @media blocks key off so
 * a future refactor can't silently regress reduced-motion or the TTS-on
 * accent state.
 */

import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { useState } from 'react'
import { AudioPlayer } from '../../src/components/AudioPlayer'
import { Composer } from '../../src/components/Composer'

describe('voice surface CSS hooks', () => {
  test('AudioPlayer compact renders no animation-bearing class names', () => {
    // The design's reduced-motion @media blocks target rx-caret, rx-firsttoken,
    // rx-reasoning__dot, rx-pill__spinner, rx-composer__recdot, rx-skel.
    // AudioPlayer carries none of those — playback is OS-driven so there's
    // nothing to suppress under prefers-reduced-motion.
    const { container } = render(<AudioPlayer variant="compact" playing progress={0.5} />)
    const animated = ['rx-caret', 'rx-firsttoken', 'rx-pill__spinner', 'rx-composer__recdot', 'rx-skel']
    for (const cls of animated) {
      expect(container.querySelector('.' + cls)).toBeNull()
    }
  })

  test('Composer TTS button gets is-on class when ttsOn is true', () => {
    function Harness({ ttsOn }: { ttsOn: boolean }) {
      const [v, setV] = useState('')
      return <Composer value={v} onChange={setV} onSubmit={() => {}} phase="idle" ttsOn={ttsOn} />
    }
    const { container, rerender } = render(<Harness ttsOn={false} />)
    expect(container.querySelector('.rx-composer__tts.is-on')).toBeNull()
    rerender(<Harness ttsOn />)
    expect(container.querySelector('.rx-composer__tts.is-on')).toBeInTheDocument()
  })

  test('AudioPlayer full variant has no scrub thumb (Web Speech Synthesis cannot seek)', () => {
    const { container } = render(<AudioPlayer variant="full" playing progress={0.6} />)
    expect(container.querySelector('.rx-audio__thumb')).toBeNull()
    expect(container.querySelector('input[type="range"]')).toBeNull()
  })
})
