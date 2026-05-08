import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSpeechRecognition } from '../../src/hooks/useSpeechRecognition'

// ── Mock SpeechRecognition ───────────────────────────────────────────────────

type ResultEntry = { transcript: string; isFinal: boolean }

interface RecLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: ((e: Event) => void) | null
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }>> & {
          length: number
          [k: number]: ArrayLike<{ transcript: string }> & { isFinal: boolean }
        }
        resultIndex?: number
      }) => void)
    | null
  onerror: ((e: { error: string }) => void) | null
  onend: ((e: Event) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

class MockSpeechRecognition implements RecLike {
  continuous = false
  interimResults = false
  lang = 'en-US'
  onstart: RecLike['onstart'] = null
  onresult: RecLike['onresult'] = null
  onerror: RecLike['onerror'] = null
  onend: RecLike['onend'] = null

  start = vi.fn(() => {
    queueMicrotask(() => this.onstart?.(new Event('start')))
  })
  stop = vi.fn()
  abort = vi.fn()

  /** Test helper — fire a results sequence as the API would. */
  emitResults(entries: ResultEntry[]) {
    const results = entries.map((e) => {
      const list = [{ transcript: e.transcript }] as unknown as ArrayLike<{ transcript: string }>
      return Object.assign(list, { isFinal: e.isFinal, length: 1 })
    })
    const evt = {
      results: Object.assign(results, { length: results.length }),
    } as unknown as Parameters<NonNullable<RecLike['onresult']>>[0]
    this.onresult?.(evt)
  }

  emitError(error: string) {
    this.onerror?.({ error })
  }

  emitEnd() {
    this.onend?.(new Event('end'))
  }
}

let activeRec: MockSpeechRecognition | null = null

function installMock(): MockSpeechRecognition {
  activeRec = new MockSpeechRecognition()
  // Use a plain function so `new MockCtor()` (constructable) returns the
  // singleton — vi.fn() arrow implementations aren't constructable.
  function MockCtor(this: MockSpeechRecognition) {
    return activeRec
  }
  Object.defineProperty(window, 'SpeechRecognition', {
    value: MockCtor,
    writable: true,
    configurable: true,
  })
  return activeRec
}

function removeMock() {
  // @ts-expect-error - intentionally deleting a window-augmented property
  delete window.SpeechRecognition
  // @ts-expect-error - same for the webkit prefix
  delete window.webkitSpeechRecognition
  activeRec = null
}

beforeEach(() => {
  removeMock()
})

afterEach(() => {
  removeMock()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useSpeechRecognition', () => {
  test('idle when SpeechRecognition is unsupported', () => {
    // No mock installed — the global is missing.
    const { result } = renderHook(() => useSpeechRecognition())
    expect(result.current.state.phase).toBe('unsupported')
  })

  test('happy path: idle → recording → idle, fires onTranscript with final text', async () => {
    const rec = installMock()
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }))
    expect(result.current.state.phase).toBe('idle')

    act(() => {
      result.current.start()
    })

    // start() runs onstart in a microtask
    await Promise.resolve()
    expect(result.current.state.phase).toBe('recording')

    // Interim result while still listening
    act(() => {
      rec.emitResults([{ transcript: 'what is ibu', isFinal: false }])
    })
    if (result.current.state.phase !== 'recording') throw new Error('expected still recording')
    expect(result.current.state.transcript).toBe('what is ibu')

    // Final result
    act(() => {
      rec.emitResults([{ transcript: 'what is ibuprofen', isFinal: true }])
      rec.emitEnd()
    })

    expect(result.current.state.phase).toBe('idle')
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith('what is ibuprofen')
  })

  test('permission denied — error.error="not-allowed" transitions to denied', async () => {
    const rec = installMock()
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.start()
    })
    await Promise.resolve()

    act(() => {
      rec.emitError('not-allowed')
      rec.emitEnd()
    })

    expect(result.current.state.phase).toBe('denied')
  })

  test('service-not-allowed also lands in denied', async () => {
    const rec = installMock()
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.start()
    })
    await Promise.resolve()
    act(() => {
      rec.emitError('service-not-allowed')
      rec.emitEnd()
    })

    expect(result.current.state.phase).toBe('denied')
  })

  test('non-permission errors map to error phase carrying the error code', async () => {
    const rec = installMock()
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.start()
    })
    await Promise.resolve()
    act(() => {
      rec.emitError('network')
      rec.emitEnd()
    })

    const s = result.current.state
    expect(s.phase).toBe('error')
    if (s.phase !== 'error') throw new Error()
    expect(s.message).toContain('network')
  })

  test('stop() calls recognition.stop and ends without firing onTranscript when no final result arrived', async () => {
    const rec = installMock()
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }))

    act(() => {
      result.current.start()
    })
    await Promise.resolve()
    act(() => {
      result.current.stop()
      rec.emitEnd()
    })

    expect(rec.stop).toHaveBeenCalled()
    expect(result.current.state.phase).toBe('idle')
    expect(onTranscript).not.toHaveBeenCalled()
  })

  test('concurrent start() while recording is a no-op', async () => {
    const rec = installMock()
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.start()
    })
    await Promise.resolve()
    expect(rec.start).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.start()
    })
    expect(rec.start).toHaveBeenCalledTimes(1)
  })

  test('uses interimResults=true and continuous=true (silence is managed manually)', async () => {
    const rec = installMock()
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => {
      result.current.start()
    })
    await Promise.resolve()
    expect(rec.continuous).toBe(true)
    expect(rec.interimResults).toBe(true)
    expect(rec.lang).toBe('en-US')
  })

  test('auto-stops after the silence timeout when no further results arrive', async () => {
    vi.useFakeTimers()
    try {
      const rec = installMock()
      const { result } = renderHook(() =>
        useSpeechRecognition({ silenceTimeoutMs: 5_000 }),
      )

      act(() => {
        result.current.start()
      })
      // Microtask fires onstart → starts the silence timer.
      await Promise.resolve()
      expect(rec.stop).not.toHaveBeenCalled()

      // Advance past the timeout — should call rec.stop() once.
      await act(async () => {
        vi.advanceTimersByTime(5_001)
      })
      expect(rec.stop).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('regression: cumulative results array (real Chrome behavior) does NOT double-count finals', async () => {
    // Chrome dispatches `result` events whose `results` is the full
    // cumulative list since recognition started; `resultIndex` points at
    // the first NEW result. Iterating from 0 every time would re-append
    // every prior final and triple-print the transcript.
    const rec = installMock()
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onTranscript }))
    act(() => {
      result.current.start()
    })
    await Promise.resolve()

    type ResMock = ArrayLike<{ transcript: string }> & { isFinal: boolean; length: number }
    const mkRes = (transcript: string, isFinal: boolean): ResMock =>
      Object.assign([{ transcript }] as ArrayLike<{ transcript: string }>, {
        isFinal,
        length: 1,
      })

    const r0 = mkRes('first ', true)

    // Event 1 — result[0] arrives final
    act(() => {
      rec.onresult?.({
        results: Object.assign([r0] as ArrayLike<ResMock>, { length: 1 }),
        resultIndex: 0,
      })
    })
    // Event 2 — full cumulative array re-emitted with new interim at [1]
    act(() => {
      const r1i = mkRes('seco', false)
      rec.onresult?.({
        results: Object.assign([r0, r1i] as ArrayLike<ResMock>, { length: 2 }),
        resultIndex: 1,
      })
    })
    // Event 3 — interim at [1] becomes final
    act(() => {
      const r1f = mkRes('second', true)
      rec.onresult?.({
        results: Object.assign([r0, r1f] as ArrayLike<ResMock>, { length: 2 }),
        resultIndex: 1,
      })
    })

    act(() => {
      rec.emitEnd()
    })

    // No duplicates — exactly "first second", not "first first first second"
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith('first second')
  })

  test('result events reset the silence timer (a steady stream of speech keeps recording)', async () => {
    vi.useFakeTimers()
    try {
      const rec = installMock()
      const { result } = renderHook(() =>
        useSpeechRecognition({ silenceTimeoutMs: 5_000 }),
      )

      act(() => {
        result.current.start()
      })
      await Promise.resolve()

      // Three result events spaced 4s apart — total elapsed 12s, but no
      // single 5s gap. The timer should never fire.
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          vi.advanceTimersByTime(4_000)
          rec.emitResults([{ transcript: `chunk-${i}`, isFinal: false }])
        })
      }
      expect(rec.stop).not.toHaveBeenCalled()

      // Now stop emitting — after 5s with no result, the timer fires.
      await act(async () => {
        vi.advanceTimersByTime(5_001)
      })
      expect(rec.stop).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
