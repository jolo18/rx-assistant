import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { captureLogger } from '../_helpers/captureLogger'
import { requestId } from '../../src/lib/middleware/requestId'
import { logger as loggerMiddleware } from '../../src/lib/middleware/logger'
import { errorHandler } from '../../src/lib/middleware/error'
import { httpError } from '../../src/lib/errors'
import type { AppEnv } from '../../src/types/hono-env'

function appWithErrorHandling() {
  const { logger, lines } = captureLogger('debug')
  const app = new Hono<AppEnv>()
  app.use('*', requestId())
  app.use('*', loggerMiddleware(logger))
  app.onError(errorHandler)
  return { app, lines }
}

describe('error middleware (NFR-3, F-7)', () => {
  test('synchronous throw → 500 INTERNAL envelope, error log, process alive', async () => {
    const { app, lines } = appWithErrorHandling()
    app.get('/boom', () => {
      throw new Error('kaboom')
    })
    app.get('/health', (c) => c.json({ status: 'ok' }))

    const boom = await app.request('/boom')
    expect(boom.status).toBe(500)
    const body = (await boom.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('INTERNAL')

    const errLine = lines.find((l) => l.msg === 'http.unhandled')
    expect(errLine).toBeDefined()
    expect(errLine!.level).toBe(50) // pino error level

    // Process is still up — subsequent request works.
    const ok = await app.request('/health')
    expect(ok.status).toBe(200)
  })

  test('HttpError preserves status + warn log, no INTERNAL masking', async () => {
    const { app, lines } = appWithErrorHandling()
    app.get('/missing', () => {
      throw httpError(404, 'NOT_FOUND', 'no such thing')
    })

    const res = await app.request('/missing')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')

    const warnLine = lines.find((l) => l.msg === 'http.error')
    expect(warnLine).toBeDefined()
    expect(warnLine!.level).toBe(40) // pino warn
    expect(warnLine!.code).toBe('NOT_FOUND')
  })

  test('AbortError → 499 + info log, no body', async () => {
    const { app, lines } = appWithErrorHandling()
    app.get('/aborted', () => {
      const e = new Error('client gone')
      e.name = 'AbortError'
      throw e
    })

    const res = await app.request('/aborted')
    expect(res.status).toBe(499)
    const infoLine = lines.find((l) => l.msg === 'http.aborted')
    expect(infoLine).toBeDefined()
    expect(infoLine!.level).toBe(30) // info
  })

  test('the http.request line still fires on errored requests', async () => {
    const { app, lines } = appWithErrorHandling()
    app.get('/boom', () => {
      throw new Error('still want a log line')
    })
    await app.request('/boom')
    const line = lines.find((l) => l.msg === 'http.request')
    expect(line).toBeDefined()
    expect(line!.status).toBe(500)
  })
})
