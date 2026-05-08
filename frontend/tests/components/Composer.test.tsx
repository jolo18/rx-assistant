import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Composer, type ComposerPhase } from '../../src/components/Composer'

function ControlledHarness({
  initialValue = '',
  phase = 'idle' as ComposerPhase,
  onSubmit = () => {},
}: {
  initialValue?: string
  phase?: ComposerPhase
  onSubmit?: (text: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  return <Composer value={value} onChange={setValue} onSubmit={onSubmit} phase={phase} />
}

describe('Composer', () => {
  test('renders the textarea with placeholder + the three action buttons', () => {
    render(<ControlledHarness />)
    expect(screen.getByPlaceholderText(/medication or a symptom/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /voice input/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /spoken replies/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^send$/i })).toBeInTheDocument()
  })

  test('typing into the textarea updates the controlled value', async () => {
    const user = userEvent.setup()
    render(<ControlledHarness />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i) as HTMLTextAreaElement
    await user.type(ta, 'hello world')
    expect(ta.value).toBe('hello world')
  })

  test('Enter submits the current text', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ControlledHarness initialValue="ibuprofen" onSubmit={onSubmit} />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('ibuprofen')
  })

  test('Shift+Enter inserts a newline and does NOT submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ControlledHarness initialValue="line1" onSubmit={onSubmit} />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i) as HTMLTextAreaElement
    ta.focus()
    // Move caret to the end
    ta.setSelectionRange(ta.value.length, ta.value.length)
    await user.keyboard('{Shift>}{Enter}{/Shift}line2')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(ta.value).toBe('line1\nline2')
  })

  test('Send button submits when clicked with non-empty text', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ControlledHarness initialValue="ibuprofen" onSubmit={onSubmit} />)
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    expect(onSubmit).toHaveBeenCalledWith('ibuprofen')
  })

  test('Send is disabled when value is empty', () => {
    render(<ControlledHarness initialValue="" />)
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()
  })

  test('Send is disabled while phase is submitting and shows a spinner', () => {
    render(<ControlledHarness initialValue="x" phase="submitting" />)
    const send = screen.getByRole('button', { name: /sending/i })
    expect(send).toBeDisabled()
    expect(send.querySelector('.rx-composer__spin')).toBeInTheDocument()
  })

  test('Send is disabled while phase is streaming', () => {
    render(<ControlledHarness initialValue="x" phase="streaming" />)
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled()
  })

  test('Enter is a no-op while phase is submitting', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ControlledHarness initialValue="x" phase="submitting" onSubmit={onSubmit} />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('Enter does not submit when value is empty', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ControlledHarness initialValue="   " onSubmit={onSubmit} />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('mic button is disabled with an unsupported tooltip when SpeechRecognition is missing', async () => {
    // No SpeechRecognition mock installed in this file — feature-detection
    // lands the hook in the `unsupported` phase and the mic stays disabled.
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<ControlledHarness initialValue="x" onSubmit={onSubmit} />)
    const mic = screen.getByRole('button', { name: /voice input/i })
    expect(mic).toBeDisabled()
    expect(mic).toHaveAttribute('title', expect.stringMatching(/not supported/i))
    await user.click(mic)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('TTS toggle: clicking forwards onToggleTts and updates icon + tooltip', async () => {
    const user = userEvent.setup()
    const onToggleTts = vi.fn()

    const { rerender } = render(
      <ControlledHarness initialValue="x" onSubmit={() => {}} />,
    )
    // Wrap with a controlled ttsOn prop so we can toggle from the outside.
    function Harness({ ttsOn }: { ttsOn: boolean }) {
      const [v, setV] = useState('x')
      return (
        <Composer
          value={v}
          onChange={setV}
          onSubmit={() => {}}
          phase="idle"
          ttsOn={ttsOn}
          onToggleTts={onToggleTts}
        />
      )
    }
    rerender(<Harness ttsOn={false} />)
    const tts = screen.getByRole('button', { name: /enable spoken replies/i })
    expect(tts).not.toBeDisabled()
    expect(tts).toHaveAttribute('title', 'Spoken replies off')
    await user.click(tts)
    expect(onToggleTts).toHaveBeenCalledTimes(1)

    rerender(<Harness ttsOn />)
    expect(screen.getByRole('button', { name: /disable spoken replies/i })).toHaveAttribute(
      'title',
      'Spoken replies on',
    )
  })

  test('renders the disclaimer copy', () => {
    render(<ControlledHarness />)
    expect(screen.getByText(/Informational only/i)).toBeInTheDocument()
  })
})
