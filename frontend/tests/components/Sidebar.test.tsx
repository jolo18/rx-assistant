import { describe, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Sidebar } from '../../src/components/Sidebar'
import type { ConversationSummary } from '../../src/lib/api'

const recentISO = (deltaMs: number) => new Date(Date.now() + deltaMs).toISOString()

const fixture: ConversationSummary[] = [
  {
    id: 'c1',
    title: 'Lisinopril dosage',
    createdAt: recentISO(-2 * 60_000),
    updatedAt: recentISO(-2 * 60_000),
  },
  {
    id: 'c2',
    title: 'Persistent cough',
    createdAt: recentISO(-3 * 3_600_000),
    updatedAt: recentISO(-3 * 3_600_000),
  },
]

function renderWithRouter(ui: React.ReactElement, route = '/c/c1') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/c/:id" element={ui} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  test('renders the conversation list with titles + relative timestamps', () => {
    renderWithRouter(<Sidebar conversations={fixture} onDelete={async () => {}} />)
    expect(screen.getByText('Lisinopril dosage')).toBeInTheDocument()
    expect(screen.getByText('Persistent cough')).toBeInTheDocument()
    expect(screen.getByText(/m ago/)).toBeInTheDocument()
    expect(screen.getByText(/h ago/)).toBeInTheDocument()
  })

  test('marks the active row from the route param', () => {
    const { container } = renderWithRouter(
      <Sidebar conversations={fixture} onDelete={async () => {}} />,
      '/c/c2',
    )
    const links = container.querySelectorAll('.rx-conv')
    expect(links[0]).not.toHaveAttribute('aria-current')
    expect(links[1]).toHaveAttribute('aria-current', 'page')
    expect(links[1]).toHaveClass('is-active')
  })

  test('renders the empty-state copy when list is empty', () => {
    renderWithRouter(<Sidebar conversations={[]} onDelete={async () => {}} />)
    expect(screen.getByText(/No conversations yet/i)).toBeInTheDocument()
  })

  test('renders an error message when the load fails', () => {
    const apiError = Object.assign(new Error('boom'), { code: 'INTERNAL', status: 500 })
    renderWithRouter(
      <Sidebar
        conversations={[]}
        error={apiError as unknown as import('../../src/lib/api').ApiError}
        onDelete={async () => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't load/i)
  })

  test('clicking the More button opens a popup menu with a single Delete row', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Sidebar conversations={fixture} onDelete={async () => {}} />)

    // Initial: no menu visible
    expect(screen.queryByRole('menu')).toBeNull()

    await user.click(screen.getByRole('button', { name: /Actions for Lisinopril dosage/i }))

    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()
    // Single-row policy — only Delete (no Rename / Pin / Archive surface).
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent(/delete/i)
  })

  test('clicking outside the menu closes it without firing onDelete', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderWithRouter(<Sidebar conversations={fixture} onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: /Actions for Lisinopril dosage/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // Click on the body / outside the menu via the document-level mousedown.
    await user.click(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
    expect(onDelete).not.toHaveBeenCalled()
  })

  test('clicking Delete in the menu fires onDelete with the row id and closes', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue({ ok: true })
    renderWithRouter(<Sidebar conversations={fixture} onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: /Actions for Lisinopril dosage/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('c1')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('collapsed variant renders open-sidebar + new-chat icons only', () => {
    renderWithRouter(<Sidebar conversations={fixture} collapsed onDelete={async () => {}} />)
    expect(screen.queryByText('Lisinopril dosage')).toBeNull()
    expect(screen.getByRole('button', { name: /open sidebar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
  })
})
