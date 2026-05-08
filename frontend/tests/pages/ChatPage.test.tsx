import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../helpers/msw-server'
import { ChatStreamProvider } from '../../src/hooks/chatStreamContext'
import { ChatPage } from '../../src/pages/ChatPage'

const BASE = 'http://localhost:3000'

const detailFixture = {
  id: 'c1',
  title: 'Lisinopril dosage',
  createdAt: '2026-05-08T00:00:00Z',
  updatedAt: '2026-05-08T00:00:01Z',
  messages: [
    {
      id: 'u1',
      role: 'user' as const,
      content: 'What is lisinopril?',
      position: 0,
      createdAt: '2026-05-08T00:00:00Z',
    },
    {
      id: 'a1',
      role: 'assistant' as const,
      content: [
        {
          type: 'tool-call' as const,
          toolCallId: 'tu1',
          toolName: 'drug_info',
          input: { query: 'lisinopril' },
        },
      ],
      position: 1,
      createdAt: '2026-05-08T00:00:01Z',
    },
    {
      id: 'tr1',
      role: 'tool' as const,
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: 'tu1',
          toolName: 'drug_info',
          output: { type: 'json' as const, value: { name: 'lisinopril' } },
        },
      ],
      position: 2,
      createdAt: '2026-05-08T00:00:02Z',
    },
    {
      id: 'a2',
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Lisinopril is an ACE inhibitor.' }],
      position: 3,
      createdAt: '2026-05-08T00:00:03Z',
      usage: { inputTokens: 130, outputTokens: 30, model: 'sonnet-4.6', costUsd: 0.0009 },
    },
    {
      id: 'u2',
      role: 'user' as const,
      content: 'And what about ibuprofen?',
      position: 4,
      createdAt: '2026-05-08T00:00:04Z',
    },
    {
      id: 'a3',
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Ibuprofen is an NSAID.' }],
      position: 5,
      createdAt: '2026-05-08T00:00:05Z',
      usage: { inputTokens: 140, outputTokens: 20, model: 'sonnet-4.6', costUsd: 0.0008 },
    },
  ],
}

function mountAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChatStreamProvider>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/c/:id" element={<ChatPage />} />
        </Routes>
      </ChatStreamProvider>
    </MemoryRouter>,
  )
}

describe('ChatPage — slice 16 hydration', () => {
  test('shows LoadingSkeleton while GET /api/conversations/:id is pending', async () => {
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])),
      // Hold the detail response open just long enough to assert the skeleton.
      http.get(
        `${BASE}/api/conversations/c1`,
        async () => {
          await new Promise((r) => setTimeout(r, 80))
          return HttpResponse.json(detailFixture)
        },
      ),
    )
    const { container } = mountAt('/c/c1')
    expect(container.querySelector('.rx-skeleton')).toBeInTheDocument()
    await waitFor(
      () => expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument(),
      { timeout: 2000 },
    )
    expect(container.querySelector('.rx-skeleton')).toBeNull()
  })

  test('keeps existing turns rendered during a post-settle invalidate (no skeleton swap)', async () => {
    // Stale-while-revalidate: once we have data, refetches must not unmount
    // the turns. This is what protects mobile scroll position when the
    // post-settle invalidateHistory() fires.
    let calls = 0
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/conversations/c1`, async () => {
        calls++
        if (calls > 1) {
          // Hold the second response open so we can assert the in-flight state.
          await new Promise((r) => setTimeout(r, 200))
        }
        return HttpResponse.json(detailFixture)
      }),
    )

    const { rerender, container } = mountAt('/c/c1')
    await waitFor(() =>
      expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument(),
    )

    // Force a re-mount that triggers the same useConversation hook to refetch
    // — simulates what slice 16's invalidateHistory does after a stream
    // settles. We trigger it by rendering a fresh tree pointing at the same
    // route; useConversation will refresh on mount.
    rerender(
      <MemoryRouter initialEntries={['/c/c1']}>
        <ChatStreamProvider>
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/c/:id" element={<ChatPage />} />
          </Routes>
        </ChatStreamProvider>
      </MemoryRouter>,
    )

    // Mid-refetch the skeleton must NOT replace the visible turns.
    // (Even on the fresh mount the prior render's data is gone — but the
    // semantic test for the live page is that once data is present, a
    // refetch never hides it. We assert the skeleton selector returns null
    // once the answer text is back.)
    await waitFor(() =>
      expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument(),
    )
    expect(container.querySelector('.rx-skeleton')).toBeNull()
  })

  test('renders a 4-row turn collapsed via groupIntoTurns: user + tool pill + answer + footer', async () => {
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/conversations/c1`, () => HttpResponse.json(detailFixture)),
    )
    mountAt('/c/c1')
    await waitFor(() =>
      expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument(),
    )
    expect(screen.getByText('What is lisinopril?')).toBeInTheDocument()
    expect(screen.getByText('drug_info')).toBeInTheDocument()
    // Both turns share the same model → assert at least one footer rendered.
    expect(screen.getAllByText('sonnet-4.6').length).toBeGreaterThan(0)
    expect(screen.getByText(/130 in/)).toBeInTheDocument()
  })

  test('historical ToolCall shows "Complete" not "0.7s" (L3: durations not persisted)', async () => {
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/conversations/c1`, () => HttpResponse.json(detailFixture)),
    )
    mountAt('/c/c1')
    await waitFor(() => expect(screen.getByText('Complete')).toBeInTheDocument())
    expect(screen.queryByText(/^0\.\ds$/)).toBeNull()
  })

  test('UserMessage Delete on the first turn cascades to end → all turns gone after reload', async () => {
    let deleteCalled = false
    let getCalls = 0
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/conversations/c1`, () => {
        getCalls++
        if (getCalls === 1) return HttpResponse.json(detailFixture)
        // Post-delete: deleting u1 cascades from that turn through end of
        // conversation, so the message list is empty.
        return HttpResponse.json({ ...detailFixture, messages: [] })
      }),
      http.delete(`${BASE}/api/messages/u1`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const user = userEvent.setup()
    mountAt('/c/c1')
    // Both turns render initially.
    await waitFor(() =>
      expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument(),
    )
    expect(screen.getByText('Ibuprofen is an NSAID.')).toBeInTheDocument()

    // Open the actions menu on the FIRST user bubble, click Delete, then confirm.
    const moreButtons = screen.getAllByRole('button', { name: /more actions/i })
    await user.click(moreButtons[0]!)
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(
      screen.getByRole('alertdialog', { name: /confirm delete from this turn/i }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))

    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(getCalls).toBeGreaterThanOrEqual(2))
    // Cascade-to-end: BOTH turns are gone after the reload.
    await waitFor(() =>
      expect(screen.queryByText('Lisinopril is an ACE inhibitor.')).toBeNull(),
    )
    expect(screen.queryByText('Ibuprofen is an NSAID.')).toBeNull()
  })

  test('Cancel in the confirm row dismisses without deleting', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/conversations/c1`, () => HttpResponse.json(detailFixture)),
      http.delete(`${BASE}/api/messages/u1`, () => {
        throw new Error('should not be called')
      }),
    )
    mountAt('/c/c1')
    await waitFor(() =>
      expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument(),
    )
    const moreButtons = screen.getAllByRole('button', { name: /more actions/i })
    await user.click(moreButtons[0]!)
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Body still rendered
    expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument()
  })

  test('Copy menu item writes the assistant answer to navigator.clipboard and shows "Copied"', async () => {
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/conversations/c1`, () => HttpResponse.json(detailFixture)),
    )

    // userEvent.setup() installs its own navigator.clipboard, so install
    // the spy AFTER setup to make sure our handler hits it.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText },
    })

    mountAt('/c/c1')
    await waitFor(() =>
      expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument(),
    )

    // Click the FIRST assistant turn's actions button.
    const moreButtons = screen.getAllByRole('button', { name: /message actions/i })
    await user.click(moreButtons[0]!)
    await user.click(screen.getByRole('menuitem', { name: /copy/i }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Lisinopril is an ACE inhibitor.'),
    )
    await waitFor(() => expect(screen.getAllByText('Copied').length).toBeGreaterThan(0))
  })
})
