import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolCall } from '../../src/components/ToolCall'

describe('ToolCall', () => {
  test('pending state renders Preparing input… and pending badge, no chevron', () => {
    const { container } = render(<ToolCall name="drug_info" state="pending" />)
    expect(container.querySelector('.rx-tool')).toHaveClass('is-pending')
    expect(screen.getByText('Preparing input…')).toBeInTheDocument()
    expect(container.querySelector('.rx-tool__chev')).toBeNull()
  })

  test('running state renders the spinner, no chevron', () => {
    const { container } = render(<ToolCall name="drug_info" state="running" />)
    expect(container.querySelector('.rx-tool')).toHaveClass('is-running')
    expect(screen.getByText('Calling tool…')).toBeInTheDocument()
    expect(container.querySelector('.rx-pill__spinner')).toBeInTheDocument()
  })

  test('complete-success uses duration as state text and shows chevron', () => {
    const { container } = render(
      <ToolCall name="drug_info" state="complete-success" duration="0.7s" />,
    )
    expect(container.querySelector('.rx-tool')).toHaveClass('is-done-success')
    expect(screen.getByText('0.7s')).toBeInTheDocument()
    expect(container.querySelector('.rx-tool__chev')).toBeInTheDocument()
  })

  test('complete-error shows warn badge and "Returned an error"', () => {
    const { container } = render(
      <ToolCall name="drug_info" state="complete-error" />,
    )
    expect(container.querySelector('.rx-tool')).toHaveClass('is-done-error')
    expect(screen.getByText('Returned an error')).toBeInTheDocument()
    expect(container.querySelector('.rx-pill__badge--warn')).toBeInTheDocument()
  })

  test('expanded body renders Input + Output sections + raw toggle', () => {
    render(
      <ToolCall
        name="drug_info"
        state="complete-success"
        expanded
        input='{"query":"ibuprofen"}'
      />,
    )
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view raw/i })).toBeInTheDocument()
    expect(screen.getByText('{"query":"ibuprofen"}')).toBeInTheDocument()
  })

  test('rawView=true shows raw output and label flips to "View formatted"', () => {
    render(
      <ToolCall
        name="drug_info"
        state="complete-success"
        expanded
        rawView
        output='{"raw":true}'
      />,
    )
    expect(screen.getByRole('button', { name: /view formatted/i })).toBeInTheDocument()
    expect(screen.getByText('{"raw":true}')).toBeInTheDocument()
  })

  test('clicking the pill fires onToggleExpanded', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<ToolCall name="drug_info" state="complete-success" onToggleExpanded={onToggle} />)
    await user.click(screen.getByRole('button', { name: /drug_info/i }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test('unknown tool name falls back to Sparkle icon and label', () => {
    render(<ToolCall name="custom_tool" state="running" />)
    expect(screen.getByText('custom_tool')).toBeInTheDocument()
  })
})
