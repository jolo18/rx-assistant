/**
 * Keyboard tab order through the composer:
 *   textarea → mic (if supported) → TTS toggle → Send
 *
 * Phase 3 lifted the mic and TTS `disabled` states, so they're now real
 * tab stops. The test below installs no SpeechRecognition mock — mic
 * stays `unsupported` (disabled) — so the only enabled buttons are TTS
 * and Send. Tab order under those conditions: textarea → TTS → Send.
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
  test('Tab from textarea advances through TTS to Send (mic disabled in this env)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    expect(ta).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: /enable spoken replies/i })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: /^send$/i })).toHaveFocus()
  })

  test('Shift+Tab walks Send → TTS → textarea', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const send = screen.getByRole('button', { name: /^send$/i })
    send.focus()

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: /enable spoken replies/i })).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByPlaceholderText(/medication or a symptom/i)).toHaveFocus()
  })

  test('disabled mic stays out of the tab order (HTML semantics)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const ta = screen.getByPlaceholderText(/medication or a symptom/i)
    ta.focus()
    await user.tab()
    // After one Tab, focus skipped the unsupported mic and landed on TTS.
    expect(screen.getByRole('button', { name: /enable spoken replies/i })).toHaveFocus()
    expect(screen.getByRole('button', { name: /voice input/i })).not.toHaveFocus()
  })
})
