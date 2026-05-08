import { describe, expect, test } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../helpers/msw-server'
import {
  ApiError,
  createConversation,
  deleteConversation,
  deleteMessage,
  getConversation,
  listConversations,
} from '../../src/lib/api'

const BASE = 'http://localhost:3000'

describe('api', () => {
  test('listConversations returns the array directly', async () => {
    const fixture = [
      { id: 'c1', title: 'A', createdAt: '2026-05-08T00:00:00Z', updatedAt: '2026-05-08T00:00:00Z' },
      { id: 'c2', title: null, createdAt: '2026-05-08T00:00:00Z', updatedAt: '2026-05-08T00:00:00Z' },
    ]
    server.use(http.get(`${BASE}/api/conversations`, () => HttpResponse.json(fixture)))
    await expect(listConversations()).resolves.toEqual(fixture)
  })

  test('getConversation returns the detail with messages', async () => {
    const fixture = {
      id: 'c1',
      title: 'A',
      createdAt: '2026-05-08T00:00:00Z',
      updatedAt: '2026-05-08T00:00:00Z',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', position: 0, createdAt: '2026-05-08T00:00:00Z' },
      ],
    }
    server.use(http.get(`${BASE}/api/conversations/c1`, () => HttpResponse.json(fixture)))
    await expect(getConversation('c1')).resolves.toEqual(fixture)
  })

  test('createConversation posts the title and returns the summary', async () => {
    let captured: unknown = null
    server.use(
      http.post(`${BASE}/api/conversations`, async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json(
          {
            id: 'c-new',
            title: 'foo',
            createdAt: '2026-05-08T00:00:00Z',
            updatedAt: '2026-05-08T00:00:00Z',
          },
          { status: 201 },
        )
      }),
    )
    const created = await createConversation('foo')
    expect(captured).toEqual({ title: 'foo' })
    expect(created.id).toBe('c-new')
  })

  test('createConversation with no title posts an empty body', async () => {
    let captured: unknown = null
    server.use(
      http.post(`${BASE}/api/conversations`, async ({ request }) => {
        captured = await request.json()
        return HttpResponse.json(
          { id: 'c', title: null, createdAt: 'x', updatedAt: 'x' },
          { status: 201 },
        )
      }),
    )
    await createConversation()
    expect(captured).toEqual({})
  })

  test('deleteConversation hits DELETE and resolves on 204', async () => {
    server.use(http.delete(`${BASE}/api/conversations/c1`, () => new HttpResponse(null, { status: 204 })))
    await expect(deleteConversation('c1')).resolves.toBeUndefined()
  })

  test('deleteMessage hits DELETE and resolves on 204', async () => {
    server.use(http.delete(`${BASE}/api/messages/m1`, () => new HttpResponse(null, { status: 204 })))
    await expect(deleteMessage('m1')).resolves.toBeUndefined()
  })

  test('throws ApiError with structured envelope on 4xx', async () => {
    server.use(
      http.get(`${BASE}/api/conversations/missing`, () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'no such conversation' } },
          { status: 404 },
        ),
      ),
    )
    await expect(getConversation('missing')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_FOUND',
      status: 404,
      message: 'no such conversation',
    })
  })

  test('synthesizes NETWORK_ERROR when fetch throws', async () => {
    server.use(http.get(`${BASE}/api/conversations`, () => HttpResponse.error()))
    await expect(listConversations()).rejects.toBeInstanceOf(ApiError)
    await expect(listConversations()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  test('falls back to INTERNAL when error body is unparseable', async () => {
    server.use(
      http.get(`${BASE}/api/conversations`, () =>
        new HttpResponse('not json at all', { status: 500 }),
      ),
    )
    await expect(listConversations()).rejects.toMatchObject({
      code: 'INTERNAL',
      status: 500,
    })
  })
})
