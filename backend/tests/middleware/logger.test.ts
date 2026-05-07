import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { captureLogger } from '../_helpers/captureLogger'
import { requestId } from '../../src/lib/middleware/requestId'
import { logger as loggerMiddleware } from '../../src/lib/middleware/logger'
import type { AppEnv } from '../../src/types/hono-env'

function appWithLogging() {
  const { logger, lines } = captureLogger('debug')
  const app = new Hono<AppEnv>()
  app.use('*', requestId())
  app.use('*', loggerMiddleware(logger))
  return { app, lines }
}

describe('logger middleware (NFR-10)', () => {
  test('emits exactly one http.request info line per request with required fields', async () => {
    const { app, lines } = appWithLogging()
    app.get('/echo', (c) => c.json({ ok: true }))

    const res = await app.request('/echo?q=1', {
      headers: { 'user-agent': 'jest', 'content-length': '0' },
    })
    expect(res.status).toBe(200)

    const httpLines = lines.filter((l) => l.msg === 'http.request')
    expect(httpLines).toHaveLength(1)
    const line = httpLines[0]!
    expect(line.layer).toBe('http')
    expect(line.method).toBe('GET')
    expect(line.path).toBe('/echo')
    expect(line.status).toBe(200)
    expect(typeof line.latencyMs).toBe('number')
    expect((line.latencyMs as number) >= 0).toBe(true)
    expect(line.userAgent).toBe('jest')
    expect(line.requestBytes).toBe(0)
    expect(line.streamed).toBe(false)
    expect(line.requestId).toBe(res.headers.get('x-request-id'))
    expect(line.query).toEqual({ q: '1' })
  })

  test('attaches a child logger with requestId baked in to c.var.logger', async () => {
    const { app, lines } = appWithLogging()
    app.get('/inner', (c) => {
      c.var.logger.info({ layer: 'service', op: 'demo' }, 'service.demo')
      return c.json({})
    })

    const res = await app.request('/inner')
    const inner = lines.find((l) => l.msg === 'service.demo')!
    expect(inner.requestId).toBe(res.headers.get('x-request-id'))
    expect(inner.layer).toBe('service')
  })

  test('merges c.var.logExtra into the terminal http.request line', async () => {
    const { app, lines } = appWithLogging()
    app.get('/with-extras', (c) => {
      c.var.logExtra.model = 'deepseek/deepseek-v4-flash'
      c.var.logExtra.inputTokens = 12
      c.var.logExtra.outputTokens = 8
      c.var.logExtra.costUsd = 0.001
      return c.json({})
    })

    await app.request('/with-extras')
    const line = lines.find((l) => l.msg === 'http.request')!
    expect(line.model).toBe('deepseek/deepseek-v4-flash')
    expect(line.inputTokens).toBe(12)
    expect(line.outputTokens).toBe(8)
    expect(line.costUsd).toBe(0.001)
  })

  test('SSE response → responseBytes:null + streamed:true', async () => {
    const { app, lines } = appWithLogging()
    app.get('/sse', (c) =>
      streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: 'ping', data: '{}' })
      }),
    )

    const res = await app.request('/sse')
    // Drain so the middleware after-hook fires
    if (res.body) {
      const reader = res.body.getReader()
      // eslint-disable-next-line no-empty
      while (!(await reader.read()).done) {}
    }
    const line = lines.find((l) => l.msg === 'http.request')!
    expect(line.streamed).toBe(true)
    expect(line.responseBytes).toBeNull()
    expect(line.path).toBe('/sse')
  })

  test('non-200 response is logged with the actual status', async () => {
    const { app, lines } = appWithLogging()
    app.get('/not-found', (c) => c.json({ error: 'nope' }, 404))
    await app.request('/not-found')
    const line = lines.find((l) => l.msg === 'http.request')!
    expect(line.status).toBe(404)
  })
})
