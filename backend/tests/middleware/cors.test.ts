import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { cors } from '../../src/lib/middleware/cors'
import type { AppEnv } from '../../src/types/hono-env'

describe('cors middleware', () => {
  test('preflight returns Access-Control-Allow-Origin: *', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', cors({ origins: '*' }))
    app.post('/api/chat', (c) => c.json({}))

    const res = await app.request('/api/chat', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-request-id',
      },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')?.split(/\s*,\s*/)).toContain('POST')
  })

  test('concrete request gets Access-Control-Allow-Origin echoed', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', cors({ origins: '*' }))
    app.get('/x', (c) => c.json({ ok: true }))

    const res = await app.request('/x', { headers: { origin: 'http://localhost:3000' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('explicit origin list rejects unknown origins', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', cors({ origins: 'http://a.example,http://b.example' }))
    app.get('/x', (c) => c.json({ ok: true }))

    const allowed = await app.request('/x', {
      headers: { origin: 'http://a.example' },
    })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://a.example')

    const denied = await app.request('/x', {
      headers: { origin: 'http://evil.example' },
    })
    // Hono cors omits the allow-origin header when the origin isn't allow-listed.
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })
})
