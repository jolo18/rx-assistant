import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReasoningPanel } from '../../src/components/ReasoningPanel'

describe('ReasoningPanel', () => {
  test('settled-collapsed renders Thoughts label and hides the body', () => {
    const { container } = render(<ReasoningPanel state="settled-collapsed" />)
    expect(screen.getByText('Thoughts')).toBeInTheDocument()
    expect(container.querySelector('.rx-reasoning__body')).toBeNull()
    expect(screen.getByRole('button', { name: /thoughts/i })).toHaveAttribute('aria-expanded', 'false')
  })

  test('streaming-expanded renders the streaming dot, Thinking label, and body', () => {
    const { container } = render(
      <ReasoningPanel state="streaming-expanded" text="…considering" />,
    )
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(container.querySelector('.rx-reasoning')).toHaveClass('is-expanded')
    expect(container.querySelector('.rx-reasoning__dot')).toHaveClass('is-streaming')
    expect(screen.getByText(/considering/)).toBeInTheDocument()
    // Caret renders under the streaming text
    expect(container.querySelector('.rx-caret')).toBeInTheDocument()
  })

  test('settled-expanded shows thoughts text without a caret', () => {
    const { container } = render(
      <ReasoningPanel state="settled-expanded" text="final thoughts" />,
    )
    expect(screen.getByText('final thoughts')).toBeInTheDocument()
    expect(container.querySelector('.rx-caret')).toBeNull()
  })

  test('reducedMotion disables the streaming dot animation', () => {
    const { container } = render(
      <ReasoningPanel state="streaming-collapsed" reducedMotion />,
    )
    expect(container.querySelector('.rx-reasoning__dot')).toHaveClass('is-reduced')
  })

  test('fires onToggle when the head is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<ReasoningPanel state="settled-collapsed" onToggle={onToggle} />)
    await user.click(screen.getByRole('button', { name: /thoughts/i }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
