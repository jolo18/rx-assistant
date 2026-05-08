import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Caret } from '../../src/components/Caret'
import { FirstTokenIndicator } from '../../src/components/FirstTokenIndicator'
import { UserMessage } from '../../src/components/UserMessage'
import { CappedNotice } from '../../src/components/CappedNotice'
import { LoadingSkeleton } from '../../src/components/LoadingSkeleton'
import { PromptSuggestions, DEFAULT_PROMPTS } from '../../src/components/PromptSuggestions'

describe('Caret', () => {
  test('renders without paused class by default', () => {
    const { container } = render(<Caret />)
    const el = container.querySelector('.rx-caret')!
    expect(el).toBeInTheDocument()
    expect(el).not.toHaveClass('is-paused')
  })

  test('renders is-paused when paused', () => {
    const { container } = render(<Caret paused />)
    expect(container.querySelector('.rx-caret')).toHaveClass('is-paused')
  })
})

describe('FirstTokenIndicator', () => {
  test('renders three pulsing dots and announces preparing status', () => {
    const { container } = render(<FirstTokenIndicator />)
    expect(screen.getByRole('status', { name: /preparing/i })).toBeInTheDocument()
    expect(container.querySelectorAll('.rx-firsttoken span')).toHaveLength(3)
  })
})

describe('UserMessage', () => {
  test('renders the user-supplied text and a More button', () => {
    render(<UserMessage text="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument()
  })

  test('shows hover affordance class when prop is set', () => {
    const { container } = render(<UserMessage text="x" showHover />)
    expect(container.querySelector('.rx-msg--user')).toHaveClass('is-hover')
  })

  test('renders timestamp only when provided', () => {
    const { rerender } = render(<UserMessage text="x" />)
    expect(screen.queryByText(/\d{2}:\d{2}/)).toBeNull()
    rerender(<UserMessage text="x" time="14:31" />)
    expect(screen.getByText('14:31')).toBeInTheDocument()
  })

  test('clicking the three-dot opens the menu', async () => {
    const user = userEvent.setup()
    render(<UserMessage text="x" onDeleteTurn={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})

describe('CappedNotice', () => {
  test('renders the cap copy', () => {
    render(<CappedNotice />)
    expect(screen.getByText(/Stopped after the maximum number/i)).toBeInTheDocument()
  })
})

describe('LoadingSkeleton', () => {
  test('renders three rows hidden from a11y', () => {
    const { container } = render(<LoadingSkeleton />)
    const root = container.querySelector('.rx-skeleton')!
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root.querySelectorAll('.rx-skeleton__row')).toHaveLength(3)
  })
})

describe('PromptSuggestions', () => {
  test('renders the four default prompts', () => {
    render(<PromptSuggestions />)
    for (const p of DEFAULT_PROMPTS) {
      expect(screen.getByText(p)).toBeInTheDocument()
    }
  })

  test('fires onSelect with the chosen prompt text', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PromptSuggestions prompts={['Pick me']} onSelect={onSelect} />)
    await user.click(screen.getByText('Pick me'))
    expect(onSelect).toHaveBeenCalledWith('Pick me')
  })
})
