/**
 * Slice 17 polish: keyboard tab order through the composer must be
 * textarea → mic (disabled, skipped) → tts (disabled, skipped) → Send.
 * Disabled buttons are non-focusable per HTML semantics, so Tab from
 * the textarea jumps straight to Send.
 */

import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Composer } from '../../src/components/Composer'

function Harness({ initialValue = 'hi' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue)
  return <Composer value={value} onChange={setValue} onSubmit={() => {}} phase="idle" />
}

describe('Composer keyboard navigation', () => {
  test('Tab from textarea advances to Send (disabled mic/TTS are skipped)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    expect(ta).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: /^send$/i })).toHaveFocus()
  })

  test('Shift+Tab from Send returns to the textarea', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const send = screen.getByRole('button', { name: /^send$/i })
    send.focus()
    expect(send).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByPlaceholderText(/medication or a symptom/i)).toHaveFocus()
  })

  test('disabled mic + tts buttons are not in the tab order', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    await user.tab()
    // After one Tab, focus is on Send — meaning Tab skipped the disabled buttons.
    expect(screen.getByRole('button', { name: /^send$/i })).toHaveFocus()
    expect(screen.getByRole('button', { name: /voice input/i })).not.toHaveFocus()
    expect(screen.getByRole('button', { name: /spoken replies/i })).not.toHaveFocus()
  })
})
