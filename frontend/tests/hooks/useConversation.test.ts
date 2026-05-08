import { describe, expect, test } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../helpers/msw-server'
import { useConversation } from '../../src/hooks/useConversation'

const BASE = 'http://localhost:3000'

const detailFixture = {
  id: 'c1',
  title: 'foo',
  createdAt: '2026-05-08T00:00:00Z',
  updatedAt: '2026-05-08T00:00:00Z',
  messages: [
    { id: 'u1', role: 'user', content: 'hi', position: 0, createdAt: '2026-05-08T00:00:00Z' },
    {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      position: 1,
      createdAt: '2026-05-08T00:00:01Z',
      usage: { inputTokens: 1, outputTokens: 1, model: 'm' },
    },
  ],
}

describe('useConversation', () => {
  test('idle when id is undefined', async () => {
    const { result } = renderHook(() => useConversation(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.conversation).toBeNull()
    expect(result.current.error).toBeNull()
  })

  test('happy path loads the detail', async () => {
    server.use(http.get(`${BASE}/api/conversations/c1`, () => HttpResponse.json(detailFixture)))
    const { result } = renderHook(() => useConversation('c1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.conversation?.id).toBe('c1')
    expect(result.current.conversation?.messages).toHaveLength(2)
  })

  test('surfaces NOT_FOUND on 404', async () => {
    server.use(
      http.get(`${BASE}/api/conversations/missing`, () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'no such conversation' } },
          { status: 404 },
        ),
      ),
    )
    const { result } = renderHook(() => useConversation('missing'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error?.code).toBe('NOT_FOUND')
    expect(result.current.conversation).toBeNull()
  })

  test('refetches when id changes', async () => {
    let lastId = ''
    server.use(
      http.get(`${BASE}/api/conversations/:id`, ({ params }) => {
        lastId = String(params.id)
        return HttpResponse.json({ ...detailFixture, id: lastId })
      }),
    )
    const { result, rerender } = renderHook(({ id }) => useConversation(id), {
      initialProps: { id: 'c1' },
    })
    await waitFor(() => expect(result.current.conversation?.id).toBe('c1'))
    rerender({ id: 'c2' })
    await waitFor(() => expect(result.current.conversation?.id).toBe('c2'))
    expect(lastId).toBe('c2')
  })
})
