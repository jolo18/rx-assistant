import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTts } from '../../src/hooks/useTts'

// ── Mock SpeechSynthesis ─────────────────────────────────────────────────────

interface UtteranceLike {
  text: string
  lang: string
  voice: SpeechSynthesisVoice | null
  volume: number
  rate: number
  pitch: number
  onstart: ((e: Event) => void) | null
  onend: ((e: Event) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onboundary: ((e: { name: string; charIndex: number; charLength: number }) => void) | null
  onpause: ((e: Event) => void) | null
  onresume: ((e: Event) => void) | null
}

class MockUtterance implements UtteranceLike {
  text: string
  lang = 'en-US'
  voice: SpeechSynthesisVoice | null = null
  volume = 1
  rate = 1
  pitch = 1
  onstart: UtteranceLike['onstart'] = null
  onend: UtteranceLike['onend'] = null
  onerror: UtteranceLike['onerror'] = null
  onboundary: UtteranceLike['onboundary'] = null
  onpause: UtteranceLike['onpause'] = null
  onresume: UtteranceLike['onresume'] = null

  constructor(text: string) {
    this.text = text
  }
}

class MockSynthesis {
  speak = vi.fn((utt: MockUtterance) => {
    this.queue.push(utt)
    this.speaking = true
    queueMicrotask(() => utt.onstart?.(new Event('start')))
  })
  cancel = vi.fn(() => {
    this.queue = []
    this.speaking = false
    this.paused = false
  })
  pause = vi.fn(() => {
    this.paused = true
  })
  resume = vi.fn(() => {
    this.paused = false
  })
  getVoices = vi.fn((): SpeechSynthesisVoice[] => [])
  speaking = false
  paused = false
  pending = false

  queue: MockUtterance[] = []

  /** Test helper — fire an `end` event on the current utterance. */
  finishCurrent() {
    const utt = this.queue.shift()
    if (!utt) return
    if (this.queue.length === 0) this.speaking = false
    utt.onend?.(new Event('end'))
  }

  /** Test helper — fire a boundary event on the current utterance. */
  emitBoundary(charIndex: number, charLength = 1) {
    const utt = this.queue[0]
    utt?.onboundary?.({ name: 'word', charIndex, charLength })
  }

  /** Test helper — fire an error event on the current utterance. */
  emitError(error: string) {
    const utt = this.queue[0]
    utt?.onerror?.({ error })
  }
}

let synth: MockSynthesis | null = null

function installSynthMock(): MockSynthesis {
  synth = new MockSynthesis()
  Object.defineProperty(window, 'speechSynthesis', {
    value: synth,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: MockUtterance,
    writable: true,
    configurable: true,
  })
  return synth
}

function removeSynthMock() {
  // @ts-expect-error - test cleanup
  delete window.speechSynthesis
  // @ts-expect-error - test cleanup
  delete window.SpeechSynthesisUtterance
  synth = null
}

beforeEach(() => removeSynthMock())
afterEach(() => removeSynthMock())

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useTts', () => {
  test('idle when SpeechSynthesis is unsupported', () => {
    // No mock installed.
    const { result } = renderHook(() => useTts())
    expect(result.current.state.status).toBe('unsupported')
  })

  test('idle when supported but no play yet', () => {
    installSynthMock()
    const { result } = renderHook(() => useTts())
    expect(result.current.state.status).toBe('idle')
  })

  test('play(text) constructs an utterance and calls speechSynthesis.speak', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())

    act(() => result.current.play('hello world'))

    expect(s.speak).toHaveBeenCalledTimes(1)
    expect(s.queue.length).toBe(1)
    expect(s.queue[0]!.text).toBe('hello world')

    await Promise.resolve()
    expect(result.current.state.status).toBe('speaking')
  })

  test('boundary events advance charIndex', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())
    act(() => result.current.play('hello world'))
    await Promise.resolve()

    act(() => s.emitBoundary(6))
    if (result.current.state.status !== 'speaking') throw new Error()
    expect(result.current.state.charIndex).toBe(6)
    expect(result.current.state.totalChars).toBe('hello world'.length)
  })

  test('end transitions to idle', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())
    act(() => result.current.play('done'))
    await Promise.resolve()
    act(() => s.finishCurrent())
    expect(result.current.state.status).toBe('idle')
  })

  test('calling play() while speaking cancels the prior utterance first', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())
    act(() => result.current.play('first'))
    await Promise.resolve()

    act(() => result.current.play('second'))
    expect(s.cancel).toHaveBeenCalled()
    expect(s.speak).toHaveBeenCalledTimes(2)
  })

  test('pause / resume transition state', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())
    act(() => result.current.play('listening'))
    await Promise.resolve()

    act(() => result.current.pause())
    expect(s.pause).toHaveBeenCalled()
    expect(result.current.state.status).toBe('paused')

    act(() => result.current.resume())
    expect(s.resume).toHaveBeenCalled()
    expect(result.current.state.status).toBe('speaking')
  })

  test('stop() cancels and returns to idle', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())
    act(() => result.current.play('text'))
    await Promise.resolve()
    act(() => result.current.stop())
    expect(s.cancel).toHaveBeenCalled()
    expect(result.current.state.status).toBe('idle')
  })

  test('error event transitions to error state with the error code', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())
    act(() => result.current.play('text'))
    await Promise.resolve()

    act(() => s.emitError('synthesis-failed'))

    const st = result.current.state
    expect(st.status).toBe('error')
    if (st.status !== 'error') throw new Error()
    expect(st.message).toContain('synthesis-failed')
  })

  test('chunks long text into ≤500-char segments and queues sequentially', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())
    // 1200 chars — split into 3 chunks at sentence boundaries
    const long =
      'A'.repeat(450) + '. ' + 'B'.repeat(450) + '. ' + 'C'.repeat(290) + '.'
    act(() => result.current.play(long))
    await Promise.resolve()

    // Only the FIRST chunk speaks immediately; subsequent chunks queue via onend.
    expect(s.speak).toHaveBeenCalledTimes(1)
    expect(s.queue[0]!.text.length).toBeLessThanOrEqual(500)

    // Finish chunk 1 → chunk 2 speaks
    act(() => s.finishCurrent())
    expect(s.speak).toHaveBeenCalledTimes(2)

    // Finish chunk 2 → chunk 3 speaks
    act(() => s.finishCurrent())
    expect(s.speak).toHaveBeenCalledTimes(3)

    // Finish chunk 3 → idle
    act(() => s.finishCurrent())
    expect(result.current.state.status).toBe('idle')
  })

  test('progress is computed across chunks (cumulative chars)', async () => {
    const s = installSynthMock()
    const { result } = renderHook(() => useTts())
    const text = 'Hello world. Goodbye world.'
    act(() => result.current.play(text))
    await Promise.resolve()

    act(() => s.emitBoundary(5))
    if (result.current.state.status !== 'speaking') throw new Error()
    expect(result.current.state.totalChars).toBe(text.length)
    expect(result.current.state.charIndex).toBeGreaterThanOrEqual(5)
  })
})
