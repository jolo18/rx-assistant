import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorPill } from '../../src/components/ErrorPill'

describe('ErrorPill — code → copy table (spec §4 Slice 12)', () => {
  const cases: Array<[code: string, copy: RegExp]> = [
    ['UPSTREAM_TIMEOUT', /Took too long to respond/],
    ['UPSTREAM_TRUNCATED', /response was cut short/],
    ['CONTENT_FILTERED', /filtered for safety/],
    ['RATE_LIMITED', /Service is busy/],
    ['NETWORK_ERROR', /reach the server/],
    ['UPSTREAM_ERROR', /went wrong while generating/],
    ['INTERNAL', /unexpected happened/],
  ]

  test.each(cases)('renders the documented copy for code %s', (code, copy) => {
    render(<ErrorPill code={code} />)
    expect(screen.getByRole('alert')).toHaveTextContent(copy)
  })

  test('falls back to the message prop when code is unknown', () => {
    render(<ErrorPill code="FUTURE_CODE" message="Custom override copy" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Custom override copy')
  })

  test('renders a generic fallback if neither code nor message resolve', () => {
    render(<ErrorPill />)
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
  })

  test('omits the retry button when no onRetry handler is supplied', () => {
    render(<ErrorPill code="UPSTREAM_TIMEOUT" />)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  test('fires onRetry when the retry button is clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorPill code="UPSTREAM_TIMEOUT" onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
