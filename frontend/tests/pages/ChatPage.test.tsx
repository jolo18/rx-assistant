import { describe, expect, test } from 'vitest'
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
    expect(screen.getByText('sonnet-4.6')).toBeInTheDocument()
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

  test('MessageFooter Delete → confirm cycle → DELETE /api/messages/:id + history reloads', async () => {
    let deleteCalled = false
    let getCalls = 0
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/conversations/c1`, () => {
        getCalls++
        if (getCalls === 1) return HttpResponse.json(detailFixture)
        // Second call (post-delete) returns the same conversation with no
        // messages — the deleted user-message cascaded the rest of the turn.
        return HttpResponse.json({ ...detailFixture, messages: [] })
      }),
      http.delete(`${BASE}/api/messages/u1`, () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const user = userEvent.setup()
    mountAt('/c/c1')
    await waitFor(() =>
      expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument(),
    )

    // Open the message-actions menu, click Delete, then confirm.
    await user.click(screen.getByRole('button', { name: /message actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(screen.getByRole('alertdialog', { name: /confirm delete turn/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))

    await waitFor(() => expect(deleteCalled).toBe(true))
    await waitFor(() => expect(getCalls).toBeGreaterThanOrEqual(2))
    // After the reload, the persisted turn is gone.
    await waitFor(() =>
      expect(screen.queryByText('Lisinopril is an ACE inhibitor.')).toBeNull(),
    )
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
    await user.click(screen.getByRole('button', { name: /message actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Body still rendered
    expect(screen.getByText('Lisinopril is an ACE inhibitor.')).toBeInTheDocument()
  })
})
