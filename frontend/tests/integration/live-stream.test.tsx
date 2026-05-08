import { describe, expect, test } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../helpers/msw-server'
import { buildSSEStream, SSE_HEADERS, type SSEEntry } from '../helpers/sse'
import { ChatStreamProvider } from '../../src/hooks/chatStreamContext'
import { ChatPage } from '../../src/pages/ChatPage'

const CHAT_URL = 'http://localhost:3000/api/chat'

const idStart = {
  messageId: '01ASSIST',
  userMessageId: '01USER',
  conversationId: '01CONV',
  model: 'anthropic/claude-sonnet-4.6',
}

function respondWithSSE(entries: ReadonlyArray<SSEEntry>) {
  return http.post(CHAT_URL, () => new HttpResponse(buildSSEStream(entries), { headers: SSE_HEADERS }))
}

function renderChat() {
  // Stub conversations endpoint so the sidebar doesn't blow up under
  // onUnhandledRequest:'error'.
  server.use(http.get('http://localhost:3000/api/conversations', () => HttpResponse.json([])))
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ChatStreamProvider>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/c/:id" element={<ChatPage />} />
        </Routes>
      </ChatStreamProvider>
    </MemoryRouter>,
  )
}

async function send(text: string) {
  const user = userEvent.setup()
  const ta = await screen.findByPlaceholderText(/medication or a symptom/i)
  await user.type(ta, text)
  await user.click(screen.getByRole('button', { name: /^send$/i }))
}

describe('live stream — slice 15 integration', () => {
  test('happy path: text + metadata renders settled assistant with footer', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'text-delta', data: { delta: 'Ibuprofen ' } },
        { event: 'text-delta', data: { delta: 'is an NSAID.' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'sonnet-4.6',
            inputTokens: 12,
            outputTokens: 8,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            latencyMs: 842,
            costUsd: 0.0001,
          },
        },
      ]),
    )
    renderChat()
    await send('What is ibuprofen?')

    await waitFor(() => expect(screen.getByText(/Ibuprofen is an NSAID/)).toBeInTheDocument(), {
      timeout: 2000,
    })
    expect(screen.getByText('What is ibuprofen?')).toBeInTheDocument()
    expect(screen.getByText('sonnet-4.6')).toBeInTheDocument()
    expect(screen.getByText(/12 in/)).toBeInTheDocument()
  })

  test('tool roundtrip: tool pill appears, then text answers', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'tool-call-start', data: { id: 'tu1', name: 'drug_info' } },
        { event: 'tool-call-end', data: { id: 'tu1', input: { query: 'ibuprofen' } } },
        {
          event: 'tool-call-result',
          data: {
            id: 'tu1',
            output: { type: 'json', value: { name: 'ibuprofen' } },
            isError: false,
            durationMs: 740,
          },
        },
        { event: 'step', data: { index: 1, reason: 'tool' } },
        { event: 'text-delta', data: { delta: 'Ibuprofen treats pain.' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'sonnet-4.6',
            inputTokens: 130,
            outputTokens: 30,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            latencyMs: 1500,
            costUsd: 0.0009,
          },
        },
      ]),
    )
    renderChat()
    await send('ibuprofen?')

    await waitFor(() => expect(screen.getByText('Ibuprofen treats pain.')).toBeInTheDocument(), {
      timeout: 2000,
    })
    expect(screen.getByText('drug_info')).toBeInTheDocument()
    expect(screen.getByText('0.7s')).toBeInTheDocument()
  })

  test('capped: last step.reason=capped surfaces <CappedNotice>', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'tool-call-start', data: { id: 'tu1', name: 'drug_info' } },
        { event: 'tool-call-end', data: { id: 'tu1', input: {} } },
        {
          event: 'tool-call-result',
          data: { id: 'tu1', output: { type: 'json', value: {} }, isError: false, durationMs: 100 },
        },
        { event: 'step', data: { index: 2, reason: 'capped' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'sonnet-4.6',
            inputTokens: 60,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            latencyMs: 200,
            costUsd: 0.0002,
          },
        },
      ]),
    )
    renderChat()
    await send('foo')

    await waitFor(
      () => expect(screen.getByText(/Stopped after the maximum/i)).toBeInTheDocument(),
      { timeout: 2000 },
    )
  })

  test('error: terminal error event renders <ErrorPill> with mapped copy', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'error', data: { code: 'UPSTREAM_TIMEOUT', message: 'too slow' } },
      ]),
    )
    renderChat()
    await send('foo')

    await waitFor(
      () => expect(screen.getByRole('alert')).toHaveTextContent(/Took too long to respond/),
      { timeout: 2000 },
    )
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  test('delete after a just-streamed turn clears the live branch (no orphan bubble)', async () => {
    // Repro the regression: stream a turn → post-settle invalidate persists
    // it → user deletes that turn → cascade-to-end empties history → live
    // chat.state still holds the just-finished turn → without resetting the
    // stream, the live branch re-appears and renders the orphaned assistant
    // text. With chat.reset() in handleDeleteTurn, the live branch stays
    // hidden and the assistant text is gone.
    let deleteCalled = false
    const finishedDetail = {
      id: '01CONV',
      title: 'Ibuprofen',
      createdAt: '2026-05-08T00:00:00Z',
      updatedAt: '2026-05-08T00:00:01Z',
      messages: [
        {
          id: '01USER',
          role: 'user' as const,
          content: 'What is ibuprofen?',
          position: 0,
          createdAt: '2026-05-08T00:00:00Z',
        },
        {
          id: '01ASSIST',
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Ibuprofen is an NSAID.' }],
          position: 1,
          createdAt: '2026-05-08T00:00:01Z',
          usage: { inputTokens: 12, outputTokens: 8, model: 'sonnet-4.6', costUsd: 0.0001 },
        },
      ],
    }

    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'text-delta', data: { delta: 'Ibuprofen ' } },
        { event: 'text-delta', data: { delta: 'is an NSAID.' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'sonnet-4.6',
            inputTokens: 12,
            outputTokens: 8,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            latencyMs: 100,
            costUsd: 0.0001,
          },
        },
      ]),
      http.get('http://localhost:3000/api/conversations/01CONV', () =>
        // Pre-delete: return the persisted turn. Post-delete: cascade-to-end
        // means the conversation is empty.
        HttpResponse.json(
          deleteCalled ? { ...finishedDetail, messages: [] } : finishedDetail,
        ),
      ),
      http.delete('http://localhost:3000/api/messages/01USER', () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderChat()
    await send('What is ibuprofen?')

    // Wait for the live stream to settle and history to take over. The
    // post-settle invalidate puts the persisted turn into `conversation`,
    // which makes `liveTurnAlreadyInHistory` true and hides the live
    // branch. Only the historical UserMessage wires `onDeleteTurn`; a
    // click on the live branch's user bubble would call `undefined` and
    // the DELETE would silently no-op. Give React enough time to flush
    // the GET response into state.
    await waitFor(
      () => expect(screen.getByText('Ibuprofen is an NSAID.')).toBeInTheDocument(),
      { timeout: 2000 },
    )
    await new Promise((r) => setTimeout(r, 200))

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))

    await waitFor(() => expect(deleteCalled).toBe(true))
    // Once the post-delete invalidate has run AND chat.reset() has cleared
    // the live state, neither the history branch nor the live branch should
    // render the assistant text anywhere.
    await waitFor(
      () => expect(screen.queryByText('Ibuprofen is an NSAID.')).toBeNull(),
      { timeout: 2000 },
    )
    expect(screen.queryByText('What is ibuprofen?')).toBeNull()
  })

  // Suppress unused-import warning while keeping the import available for
  // any future tests in this file that need fake timers.
  void act
})
