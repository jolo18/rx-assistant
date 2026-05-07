import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { requestId } from '../../src/lib/middleware/requestId'
import type { AppEnv } from '../../src/types/hono-env'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

function appWithRequestId() {
  const app = new Hono<AppEnv>()
  app.use('*', requestId())
  app.get('/', (c) => c.json({ id: c.var.requestId }))
  return app
}

describe('requestId middleware', () => {
  test('generates a ULID and sets x-request-id when none provided', async () => {
    const app = appWithRequestId()
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const header = res.headers.get('x-request-id')
    expect(header).not.toBeNull()
    expect(header!).toMatch(ULID_RE)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe(header!)
  })

  test('honors incoming X-Request-Id verbatim', async () => {
    const app = appWithRequestId()
    const res = await app.request('/', { headers: { 'x-request-id': 'trace-abc-123' } })
    expect(res.headers.get('x-request-id')).toBe('trace-abc-123')
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe('trace-abc-123')
  })

  test('falls back to ULID when incoming header is empty', async () => {
    const app = appWithRequestId()
    const res = await app.request('/', { headers: { 'x-request-id': '' } })
    expect(res.headers.get('x-request-id')).toMatch(ULID_RE)
  })

  test('falls back to ULID when incoming header is absurdly long', async () => {
    const app = appWithRequestId()
    const res = await app.request('/', {
      headers: { 'x-request-id': 'x'.repeat(500) },
    })
    expect(res.headers.get('x-request-id')).toMatch(ULID_RE)
  })

  test('each request gets a distinct id', async () => {
    const app = appWithRequestId()
    const a = (await (await app.request('/')).json()) as { id: string }
    const b = (await (await app.request('/')).json()) as { id: string }
    expect(a.id).not.toBe(b.id)
  })
})
