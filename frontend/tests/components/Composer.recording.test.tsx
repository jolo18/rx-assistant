import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Composer } from '../../src/components/Composer'

// Lightweight mock of SpeechRecognition for the Composer tests.
class MockRec {
  continuous = false
  interimResults = false
  lang = 'en-US'
  onstart: ((e: Event) => void) | null = null
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> & { length: number } }) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: ((e: Event) => void) | null = null
  start = vi.fn(() => {
    queueMicrotask(() => this.onstart?.(new Event('start')))
  })
  stop = vi.fn()
  abort = vi.fn()

  emitFinal(text: string) {
    const list = [{ transcript: text }] as unknown as ArrayLike<{ transcript: string }> & {
      isFinal: boolean
    }
    Object.assign(list, { isFinal: true, length: 1 })
    this.onresult?.({ results: Object.assign([list], { length: 1 }) })
  }
}

let activeRec: MockRec | null = null

function installRecMock(): MockRec {
  activeRec = new MockRec()
  function MockCtor(this: MockRec) {
    return activeRec
  }
  Object.defineProperty(window, 'SpeechRecognition', {
    value: MockCtor,
    writable: true,
    configurable: true,
  })
  return activeRec
}

function removeRecMock() {
  // @ts-expect-error - test cleanup
  delete window.SpeechRecognition
  // @ts-expect-error - test cleanup
  delete window.webkitSpeechRecognition
  activeRec = null
}

beforeEach(() => removeRecMock())
afterEach(() => removeRecMock())

function ControlledHarness({ initialDraft = '' }: { initialDraft?: string }) {
  const [value, setValue] = useState(initialDraft)
  return <Composer value={value} onChange={setValue} onSubmit={() => {}} phase="idle" />
}

describe('Composer mic wiring', () => {
  test('mic is enabled when SpeechRecognition is available', () => {
    installRecMock()
    render(<ControlledHarness />)
    const mic = screen.getByRole('button', { name: /voice input/i })
    expect(mic).not.toBeDisabled()
  })

  test('mic stays disabled with the unsupported tooltip when the API is missing', () => {
    // No mock installed — global is absent.
    render(<ControlledHarness />)
    const mic = screen.getByRole('button', { name: /voice input/i })
    expect(mic).toBeDisabled()
    expect(mic).toHaveAttribute('title', expect.stringMatching(/not supported/i))
  })

  test('clicking the mic starts recording and the recording dot appears', async () => {
    const rec = installRecMock()
    const user = userEvent.setup()
    const { container } = render(<ControlledHarness />)
    await user.click(screen.getByRole('button', { name: /voice input/i }))
    await Promise.resolve() // microtask for onstart
    expect(rec.start).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.rx-composer__recdot')).toBeInTheDocument()
  })

  test('a final transcript replaces the draft via the controlled onChange', async () => {
    const rec = installRecMock()
    const user = userEvent.setup()
    render(<ControlledHarness initialDraft="initial" />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i) as HTMLTextAreaElement

    await user.click(screen.getByRole('button', { name: /voice input/i }))
    await Promise.resolve()

    act(() => {
      rec.emitFinal('what is ibuprofen')
      rec.onend?.(new Event('end'))
    })

    expect(ta.value).toBe('what is ibuprofen')
  })

  test('clicking the mic again while recording calls stop()', async () => {
    const rec = installRecMock()
    const user = userEvent.setup()
    render(<ControlledHarness />)

    const mic = screen.getByRole('button', { name: /voice input/i })
    await user.click(mic)
    await Promise.resolve()

    await user.click(mic)
    expect(rec.stop).toHaveBeenCalled()
  })

  test('denied permission shows the lock icon + denied tooltip', async () => {
    const rec = installRecMock()
    const user = userEvent.setup()
    const { container } = render(<ControlledHarness />)
    await user.click(screen.getByRole('button', { name: /voice input/i }))
    await Promise.resolve()
    act(() => {
      rec.onerror?.({ error: 'not-allowed' })
      rec.onend?.(new Event('end'))
    })

    const mic = screen.getByRole('button', { name: /voice input/i })
    expect(mic).toHaveAttribute('title', expect.stringMatching(/permission denied/i))
    expect(container.querySelector('.rx-composer__mic.is-denied')).toBeInTheDocument()
  })
})
