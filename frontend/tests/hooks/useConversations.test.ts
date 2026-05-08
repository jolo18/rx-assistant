import { describe, expect, test } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../helpers/msw-server'
import { useConversations } from '../../src/hooks/useConversations'

const BASE = 'http://localhost:3000'

const sampleList = [
  { id: 'c1', title: 'first', createdAt: '2026-05-08T00:00:00Z', updatedAt: '2026-05-08T00:01:00Z' },
  { id: 'c2', title: 'second', createdAt: '2026-05-08T00:00:00Z', updatedAt: '2026-05-08T00:00:30Z' },
]

describe('useConversations', () => {
  test('starts in loading=true and resolves with the list', async () => {
    server.use(http.get(`${BASE}/api/conversations`, () => HttpResponse.json(sampleList)))

    const { result } = renderHook(() => useConversations())
    expect(result.current.loading).toBe(true)
    expect(result.current.conversations).toEqual([])

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.conversations).toEqual(sampleList)
    expect(result.current.error).toBeNull()
  })

  test('returns an empty list cleanly', async () => {
    server.use(http.get(`${BASE}/api/conversations`, () => HttpResponse.json([])))

    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.conversations).toEqual([])
    expect(result.current.error).toBeNull()
  })

  test('surfaces ApiError on 5xx', async () => {
    server.use(
      http.get(`${BASE}/api/conversations`, () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
    )

    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error?.code).toBe('INTERNAL')
    expect(result.current.error?.message).toBe('boom')
  })

  test('invalidate() re-fetches with the latest server data', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/api/conversations`, () => {
        calls++
        return HttpResponse.json(calls === 1 ? sampleList : [sampleList[0]!])
      }),
    )

    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.conversations).toHaveLength(2)

    await act(async () => {
      await result.current.invalidate()
    })

    expect(result.current.conversations).toHaveLength(1)
    expect(calls).toBe(2)
  })

  test('deleteConversation removes optimistically and refreshes after 204', async () => {
    let listCalls = 0
    server.use(
      http.get(`${BASE}/api/conversations`, () => {
        listCalls++
        // First call returns the full list; second call (after delete) returns one row.
        return HttpResponse.json(
          listCalls === 1 ? sampleList : sampleList.filter((c) => c.id !== 'c1'),
        )
      }),
      http.delete(`${BASE}/api/conversations/c1`, () => new HttpResponse(null, { status: 204 })),
    )

    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.conversations).toHaveLength(2)

    await act(async () => {
      await result.current.deleteConversation('c1')
    })

    expect(result.current.conversations.map((c) => c.id)).toEqual(['c2'])
    expect(listCalls).toBe(2) // initial + post-delete refresh
  })

  test('rolls back optimistic removal when the delete fails', async () => {
    server.use(
      http.get(`${BASE}/api/conversations`, () => HttpResponse.json(sampleList)),
      http.delete(`${BASE}/api/conversations/c1`, () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'down' } }, { status: 500 }),
      ),
    )

    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.loading).toBe(false))

    let outcome: Awaited<ReturnType<typeof result.current.deleteConversation>> | null = null
    await act(async () => {
      outcome = await result.current.deleteConversation('c1')
    })

    expect(outcome).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    // List should still contain both rows
    expect(result.current.conversations.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(result.current.error?.code).toBe('INTERNAL')
  })
})
