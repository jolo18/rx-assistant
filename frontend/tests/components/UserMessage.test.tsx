import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserMessage } from '../../src/components/UserMessage'

describe('UserMessage', () => {
  test('renders text + the three-dot button', () => {
    render(<UserMessage text="Hello there" />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument()
  })

  test('clicking the three-dot opens / closes the menu', async () => {
    const user = userEvent.setup()
    render(<UserMessage text="hi" onDeleteTurn={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()

    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /copy/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('Esc closes the menu', async () => {
    const user = userEvent.setup()
    render(<UserMessage text="hi" onDeleteTurn={() => {}} />)
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('clicking outside closes the menu', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <UserMessage text="hi" onDeleteTurn={() => {}} />
        <button type="button">outside</button>
      </div>,
    )
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('Copy writes the user text to clipboard, shows "Copied", and closes the menu', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText },
    })

    render(<UserMessage text="What is lisinopril?" />)
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /copy/i }))

    expect(writeText).toHaveBeenCalledWith('What is lisinopril?')
    expect(screen.getByText('Copied')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('Delete shows the inline confirm row', async () => {
    const user = userEvent.setup()
    render(<UserMessage text="hi" onDeleteTurn={() => {}} />)
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(
      screen.getByRole('alertdialog', { name: /confirm delete from this turn/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Delete$/ })).toBeInTheDocument()
  })

  test('Cancel in the confirm row dismisses without firing onDeleteTurn', async () => {
    const user = userEvent.setup()
    const onDeleteTurn = vi.fn()
    render(<UserMessage text="hi" onDeleteTurn={onDeleteTurn} />)
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onDeleteTurn).not.toHaveBeenCalled()
  })

  test('Confirming Delete fires onDeleteTurn', async () => {
    const user = userEvent.setup()
    const onDeleteTurn = vi.fn()
    render(<UserMessage text="hi" onDeleteTurn={onDeleteTurn} />)
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(onDeleteTurn).toHaveBeenCalledTimes(1)
  })

  test('hides the Delete item when onDeleteTurn is omitted (live pending-user case)', async () => {
    const user = userEvent.setup()
    render(<UserMessage text="in-flight prompt" />)
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /copy/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull()
  })
})
