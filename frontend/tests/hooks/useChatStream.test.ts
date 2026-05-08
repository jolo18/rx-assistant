import { describe, expect, test } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../helpers/msw-server'
import { buildSSEStream, SSE_HEADERS, type SSEEntry } from '../helpers/sse'
import { useChatStream } from '../../src/hooks/useChatStream'

const CHAT_URL = 'http://localhost:3000/api/chat'

function respondWithSSE(entries: ReadonlyArray<SSEEntry>) {
  return http.post(CHAT_URL, () => new HttpResponse(buildSSEStream(entries), { headers: SSE_HEADERS }))
}

const idStart = {
  messageId: '01ASSIST',
  userMessageId: '01USER',
  conversationId: '01CONV',
  model: 'anthropic/claude-sonnet-4.6',
}

describe('useChatStream', () => {
  test('starts in idle phase before send', () => {
    const { result } = renderHook(() => useChatStream())
    expect(result.current.state.phase).toBe('idle')
  })

  test('I-1 happy path — text-only response settles to done', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'text-delta', data: { delta: 'Ibu' } },
        { event: 'text-delta', data: { delta: 'profen' } },
        { event: 'text-delta', data: { delta: ' is an NSAID.' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'anthropic/claude-sonnet-4.6',
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

    const { result } = renderHook(() => useChatStream())

    let tempId: string
    act(() => {
      tempId = result.current.send('What is ibuprofen?').tempUserMessageId
    })
    expect(tempId!).toMatch(/^temp-/)

    await waitFor(() => expect(result.current.state.phase).toBe('done'))

    const s = result.current.state
    if (s.phase !== 'done') throw new Error('expected done')
    expect(s.assistant.text).toBe('Ibuprofen is an NSAID.')
    expect(s.assistant.userMessageId).toBe('01USER')
    expect(s.assistant.messageId).toBe('01ASSIST')
    expect(s.assistant.conversationId).toBe('01CONV')
    expect(s.assistant.metadata?.inputTokens).toBe(12)
    expect(s.assistant.metadata?.outputTokens).toBe(8)
    expect(s.assistant.metadata?.latencyMs).toBe(842)
    expect(s.assistant.toolCalls).toHaveLength(0)
    expect(s.assistant.reasoning.text).toBe('')
  })

  test('I-1r reasoning streamed before text', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'reasoning-start', data: {} },
        { event: 'reasoning-delta', data: { delta: 'I should ' } },
        { event: 'reasoning-delta', data: { delta: 'mention NSAID.' } },
        { event: 'reasoning-end', data: {} },
        { event: 'text-delta', data: { delta: 'Ibuprofen is an NSAID.' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'anthropic/claude-sonnet-4.6',
            inputTokens: 10,
            outputTokens: 6,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            latencyMs: 100,
            costUsd: 0.00005,
          },
        },
      ]),
    )

    const { result } = renderHook(() => useChatStream())
    act(() => void result.current.send('foo'))

    await waitFor(() => expect(result.current.state.phase).toBe('done'))
    const s = result.current.state
    if (s.phase !== 'done') throw new Error()
    expect(s.assistant.reasoning.text).toBe('I should mention NSAID.')
    expect(s.assistant.reasoning.done).toBe(true)
    expect(s.assistant.text).toBe('Ibuprofen is an NSAID.')
  })

  test('I-2 single tool call — full roundtrip', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'tool-call-start', data: { id: 'tu1', name: 'drug_info' } },
        { event: 'tool-call-delta', data: { id: 'tu1', partialInput: '{"qu' } },
        { event: 'tool-call-delta', data: { id: 'tu1', partialInput: 'ery":"ibuprofen"}' } },
        { event: 'tool-call-end', data: { id: 'tu1', input: { query: 'ibuprofen' } } },
        {
          event: 'tool-call-result',
          data: {
            id: 'tu1',
            output: { type: 'json', value: { name: 'ibuprofen', indications: 'pain' } },
            isError: false,
            durationMs: 124,
          },
        },
        { event: 'step', data: { index: 1, reason: 'tool' } },
        { event: 'text-delta', data: { delta: 'Ibuprofen treats pain.' } },
        { event: 'step', data: { index: 2, reason: 'final' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'anthropic/claude-sonnet-4.6',
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

    const { result } = renderHook(() => useChatStream())
    act(() => void result.current.send('What is ibuprofen?'))

    await waitFor(() => expect(result.current.state.phase).toBe('done'))
    const s = result.current.state
    if (s.phase !== 'done') throw new Error()

    expect(s.assistant.toolCalls).toHaveLength(1)
    const tc = s.assistant.toolCalls[0]!
    expect(tc.id).toBe('tu1')
    expect(tc.name).toBe('drug_info')
    expect(tc.state).toBe('complete-success')
    expect(tc.partialInput).toBe('{"query":"ibuprofen"}')
    expect(tc.input).toEqual({ query: 'ibuprofen' })
    expect(tc.output).toEqual({ type: 'json', value: { name: 'ibuprofen', indications: 'pain' } })
    expect(tc.durationMs).toBe(124)

    expect(s.assistant.steps).toHaveLength(2)
    expect(s.assistant.steps[0]).toEqual({ index: 1, reason: 'tool' })
    expect(s.assistant.steps[1]).toEqual({ index: 2, reason: 'final' })

    expect(s.assistant.text).toBe('Ibuprofen treats pain.')
    expect(s.assistant.metadata?.inputTokens).toBe(130)
    expect(s.assistant.metadata?.outputTokens).toBe(30)
  })

  test('I-2e tool error — toolCall flips to complete-error and loop continues', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'tool-call-start', data: { id: 'tu1', name: 'drug_info' } },
        { event: 'tool-call-end', data: { id: 'tu1', input: { query: 'ibuprofen' } } },
        {
          event: 'tool-call-result',
          data: {
            id: 'tu1',
            output: { type: 'error-text', value: 'openFDA 503' },
            isError: true,
            durationMs: 50,
          },
        },
        { event: 'step', data: { index: 1, reason: 'tool' } },
        { event: 'text-delta', data: { delta: 'Sorry, lookup failed.' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'm',
            inputTokens: 5,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            latencyMs: 200,
            costUsd: 0.0001,
          },
        },
      ]),
    )

    const { result } = renderHook(() => useChatStream())
    act(() => void result.current.send('foo'))

    await waitFor(() => expect(result.current.state.phase).toBe('done'))
    const s = result.current.state
    if (s.phase !== 'done') throw new Error()
    expect(s.assistant.toolCalls[0]!.state).toBe('complete-error')
    expect(s.assistant.text).toBe('Sorry, lookup failed.')
  })

  test('I-3 step cap reached — last step.reason is capped, no error', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'tool-call-start', data: { id: 'tu1', name: 'drug_info' } },
        { event: 'tool-call-end', data: { id: 'tu1', input: { query: 'x' } } },
        {
          event: 'tool-call-result',
          data: { id: 'tu1', output: { type: 'json', value: { ok: true } }, isError: false, durationMs: 10 },
        },
        { event: 'step', data: { index: 1, reason: 'tool' } },
        { event: 'tool-call-start', data: { id: 'tu2', name: 'drug_info' } },
        { event: 'tool-call-end', data: { id: 'tu2', input: { query: 'x' } } },
        {
          event: 'tool-call-result',
          data: { id: 'tu2', output: { type: 'json', value: { ok: true } }, isError: false, durationMs: 10 },
        },
        { event: 'step', data: { index: 2, reason: 'capped' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'm',
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

    const { result } = renderHook(() => useChatStream())
    act(() => void result.current.send('foo'))

    await waitFor(() => expect(result.current.state.phase).toBe('done'))
    const s = result.current.state
    if (s.phase !== 'done') throw new Error()
    expect(s.assistant.toolCalls).toHaveLength(2)
    expect(s.assistant.steps.at(-1)).toEqual({ index: 2, reason: 'capped' })
    expect(s.assistant.text).toBe('')
  })

  test('I-8 upstream timeout — terminal error event', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'error', data: { code: 'UPSTREAM_TIMEOUT', message: 'Took too long' } },
      ]),
    )

    const { result } = renderHook(() => useChatStream())
    act(() => void result.current.send('foo'))

    await waitFor(() => expect(result.current.state.phase).toBe('error'))
    const s = result.current.state
    if (s.phase !== 'error') throw new Error()
    expect(s.code).toBe('UPSTREAM_TIMEOUT')
    expect(s.message).toBe('Took too long')
  })

  test('I-9 provider error mid-stream — error after partial tool-call', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'tool-call-start', data: { id: 'tu1', name: 'drug_info' } },
        { event: 'tool-call-delta', data: { id: 'tu1', partialInput: '{"que' } },
        { event: 'error', data: { code: 'UPSTREAM_ERROR', message: 'provider blew up' } },
      ]),
    )

    const { result } = renderHook(() => useChatStream())
    act(() => void result.current.send('foo'))

    await waitFor(() => expect(result.current.state.phase).toBe('error'))
    const s = result.current.state
    if (s.phase !== 'error') throw new Error()
    expect(s.code).toBe('UPSTREAM_ERROR')
  })

  test('optimistic-user reconciliation — temp id surfaced, canonical id arrives on start', async () => {
    server.use(
      respondWithSSE([
        { event: 'start', data: idStart },
        { event: 'text-delta', data: { delta: 'ok' } },
        {
          event: 'metadata',
          data: {
            messageId: '01ASSIST',
            model: 'm',
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            latencyMs: 1,
            costUsd: 0,
          },
        },
      ]),
    )

    const { result } = renderHook(() => useChatStream())

    let tempId = ''
    act(() => {
      tempId = result.current.send('hello').tempUserMessageId
    })
    expect(tempId).toMatch(/^temp-/)
    expect(tempId).not.toBe(idStart.userMessageId)

    await waitFor(() => expect(result.current.state.phase).toBe('done'))
    const s = result.current.state
    if (s.phase !== 'done') throw new Error()
    expect(s.assistant.userMessageId).toBe(idStart.userMessageId)
    // The canonical id from start.userMessageId is now the source of truth.
    expect(s.assistant.userMessageId).not.toBe(tempId)
  })

  test('network error before any frame — synthetic NETWORK_ERROR', async () => {
    server.use(
      http.post(CHAT_URL, () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
    )

    const { result } = renderHook(() => useChatStream())
    act(() => void result.current.send('foo'))

    await waitFor(() => expect(result.current.state.phase).toBe('error'))
    const s = result.current.state
    if (s.phase !== 'error') throw new Error()
    expect(s.code).toBe('NETWORK_ERROR')
  })

  test('passes conversationId through to the request body when provided', async () => {
    let capturedBody: unknown = null
    server.use(
      http.post(CHAT_URL, async ({ request }) => {
        capturedBody = await request.json()
        return new HttpResponse(
          buildSSEStream([
            { event: 'start', data: idStart },
            {
              event: 'metadata',
              data: {
                messageId: '01ASSIST',
                model: 'm',
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheCreateTokens: 0,
                latencyMs: 1,
                costUsd: 0,
              },
            },
          ]),
          { headers: SSE_HEADERS },
        )
      }),
    )

    const { result } = renderHook(() => useChatStream({ conversationId: '01CONV-EXISTING' }))
    act(() => void result.current.send('continue'))

    await waitFor(() => expect(result.current.state.phase).toBe('done'))
    expect(capturedBody).toMatchObject({
      conversationId: '01CONV-EXISTING',
      message: 'continue',
    })
  })
})
