/**
 * Keyboard tab order through the composer (2-button rule).
 *
 * The right slot in the actions row swaps based on draft state:
 *   - empty draft → mic + TTS toggle
 *   - non-empty draft → mic + Send
 *
 * The mic stays disabled in this test env (no SpeechRecognition global), so
 * focus skips it and lands on the lone right-slot button. Tab order:
 *   - empty: textarea → TTS
 *   - non-empty: textarea → Send
 */

import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Composer } from '../../src/components/Composer'

function Harness({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue)
  return <Composer value={value} onChange={setValue} onSubmit={() => {}} phase="idle" />
}

describe('Composer keyboard navigation', () => {
  test('empty draft: Tab from textarea lands on the TTS toggle', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    expect(ta).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: /enable spoken replies/i })).toHaveFocus()
  })

  test('non-empty draft: Tab from textarea lands on Send', async () => {
    const user = userEvent.setup()
    render(<Harness initialValue="hi" />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()

    await user.tab()
    expect(screen.getByRole('button', { name: /^send$/i })).toHaveFocus()
  })

  test('Shift+Tab walks Send → textarea (no TTS in tab order with text present)', async () => {
    const user = userEvent.setup()
    render(<Harness initialValue="hi" />)
    const send = screen.getByRole('button', { name: /^send$/i })
    send.focus()

    await user.tab({ shift: true })
    expect(screen.getByPlaceholderText(/medication or a symptom/i)).toHaveFocus()
  })

  test('disabled mic stays out of the tab order (HTML semantics)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    await user.tab()
    // After one Tab, focus skipped the unsupported mic and landed on the
    // right-slot button (TTS, since draft is empty).
    expect(screen.getByRole('button', { name: /enable spoken replies/i })).toHaveFocus()
    expect(screen.getByRole('button', { name: /voice input/i })).not.toHaveFocus()
  })
})
