import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageFooter } from '../../src/components/MessageFooter'

describe('MessageFooter', () => {
  const baseProps = {
    model: 'sonnet-4.6',
    tokensIn: 1204,
    tokensOut: 387,
    cost: 0.0072,
  }

  test('renders model, formatted tokens, and cost', () => {
    render(<MessageFooter {...baseProps} />)
    expect(screen.getByText('sonnet-4.6')).toBeInTheDocument()
    expect(screen.getByText(/1,204 in/)).toBeInTheDocument()
    expect(screen.getByText(/387 out/)).toBeInTheDocument()
    expect(screen.getByText('$0.0072')).toBeInTheDocument()
  })

  test('shows cached chip only when cached > 0', () => {
    const { rerender } = render(<MessageFooter {...baseProps} />)
    expect(screen.queryByText(/cached/)).toBeNull()
    rerender(<MessageFooter {...baseProps} cached={500} />)
    expect(screen.getByText(/\(500 cached\)/)).toBeInTheDocument()
  })

  test('renders the menu only when showMenu is true', () => {
    const { rerender } = render(<MessageFooter {...baseProps} />)
    expect(screen.queryByRole('menu')).toBeNull()
    rerender(<MessageFooter {...baseProps} showMenu />)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /copy/i })).toBeInTheDocument()
    // Delete lives on the UserMessage menu now, not here.
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull()
  })

  test('formats sub-cent costs as <$0.0001', () => {
    render(<MessageFooter {...baseProps} cost={0.00005} />)
    expect(screen.getByText('<$0.0001')).toBeInTheDocument()
  })

  test('fires onCopy from menu item', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    render(<MessageFooter {...baseProps} showMenu onCopy={onCopy} />)
    await user.click(screen.getByRole('menuitem', { name: /copy/i }))
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  test('shows transient "Copied" caption when copied=true', () => {
    render(<MessageFooter {...baseProps} copied />)
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })
})
