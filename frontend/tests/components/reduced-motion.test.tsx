/**
 * Slice 17 polish: smoke-test that components emit the CSS classes the
 * design's `@media (prefers-reduced-motion: reduce)` blocks key off — so
 * users with the OS preference set get static caret, dotted spinner,
 * non-pulsing dot, etc.
 */

import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { Caret } from '../../src/components/Caret'
import { FirstTokenIndicator } from '../../src/components/FirstTokenIndicator'
import { ReasoningPanel } from '../../src/components/ReasoningPanel'
import { ToolCall } from '../../src/components/ToolCall'

describe('reduced-motion class hooks', () => {
  test('Caret renders the .rx-caret class the reduced-motion rule keys off', () => {
    const { container } = render(<Caret />)
    expect(container.querySelector('.rx-caret')).toBeInTheDocument()
  })

  test('FirstTokenIndicator renders the .rx-firsttoken span elements the rule keys off', () => {
    const { container } = render(<FirstTokenIndicator />)
    expect(container.querySelectorAll('.rx-firsttoken span')).toHaveLength(3)
  })

  test('ReasoningPanel streaming dot can take .is-reduced when prop is set', () => {
    const { container } = render(
      <ReasoningPanel state="streaming-collapsed" reducedMotion />,
    )
    expect(container.querySelector('.rx-reasoning__dot.is-streaming.is-reduced')).toBeInTheDocument()
  })

  test('ToolCall running spinner can take .is-reduced when prop is set', () => {
    const { container } = render(
      <ToolCall name="drug_info" state="running" reducedMotion />,
    )
    expect(container.querySelector('.rx-pill__spinner.is-reduced')).toBeInTheDocument()
  })
})
