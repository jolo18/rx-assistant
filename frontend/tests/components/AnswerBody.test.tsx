import { describe, expect, test } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AnswerBody } from '../../src/components/AnswerBody'

describe('AnswerBody', () => {
  test('renders plain text settled', () => {
    render(<AnswerBody text="Hello world" settled />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  test('renders markdown headings + bold + lists', () => {
    const md = `## Heading\n\nA **bold** word and a list:\n\n- one\n- two`
    const { container } = render(<AnswerBody text={md} settled />)
    expect(container.querySelector('h2')).toHaveTextContent('Heading')
    expect(container.querySelector('strong')).toHaveTextContent('bold')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  test('renders GFM tables (remark-gfm)', () => {
    const md = `| a | b |\n| --- | --- |\n| 1 | 2 |`
    const { container } = render(<AnswerBody text={md} settled />)
    expect(container.querySelector('table')).toBeInTheDocument()
    expect(container.querySelector('thead th')).toHaveTextContent('a')
  })

  test('settled=true reparses instantly when text changes', () => {
    const { rerender } = render(<AnswerBody text="first" settled />)
    expect(screen.getByText('first')).toBeInTheDocument()
    rerender(<AnswerBody text="second" settled />)
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.queryByText('first')).toBeNull()
  })

  test('streaming (settled=false) defers reparse by ~50ms — bursts collapse to one render', async () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<AnswerBody text="A" settled={false} />)
      // Initial render commits A immediately (initial state).
      expect(screen.getByText('A')).toBeInTheDocument()

      rerender(<AnswerBody text="A B" settled={false} />)
      rerender(<AnswerBody text="A B C" settled={false} />)
      rerender(<AnswerBody text="A B C D" settled={false} />)

      // Without the timer firing, the displayed text is still the previous
      // committed value (A) — debounce is holding.
      expect(screen.getByText('A')).toBeInTheDocument()

      await act(async () => {
        vi.advanceTimersByTime(60)
      })

      expect(screen.getByText('A B C D')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

import { vi } from 'vitest'
