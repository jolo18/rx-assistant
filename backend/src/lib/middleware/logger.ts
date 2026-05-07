import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../../types/hono-env.ts'
import { childForRequest, type Logger } from '../logger.ts'

/**
 * Verbose request log line (Slice 8 pick): one info-level `http.request`
 * entry per response, merging transport metadata + anything the route /
 * service wrote into `c.var.logExtra` (e.g. chat-extras for /api/chat).
 *
 * SSE responses don't carry Content-Length; we set `responseBytes: null` and
 * `streamed: true` instead. Latency is `performance.now()` deltas — monotonic
 * regardless of wall-clock skew.
 */
export function logger(root: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = c.var.requestId ?? 'unknown'
    const log = childForRequest(root, id)
    c.set('logger', log)
    c.set('logExtra', {})

    const t0 = performance.now()
    let errored = false
    try {
      await next()
    } catch (err) {
      errored = true
      throw err
    } finally {
      const latencyMs = Math.round(performance.now() - t0)
      const requestBytes = parseIntHeader(c.req.header('content-length'))
      const responseBytes = parseIntHeader(c.res.headers.get('content-length'))
      const streamed = (c.res.headers.get('content-type') ?? '').startsWith('text/event-stream')
      const url = new URL(c.req.url)
      const query = url.search.length > 1 ? Object.fromEntries(url.searchParams) : undefined
      const userAgent = c.req.header('user-agent') ?? null

      log.info(
        {
          layer: 'http',
          method: c.req.method,
          path: url.pathname,
          status: errored ? 500 : c.res.status,
          latencyMs,
          userAgent,
          requestBytes,
          responseBytes: streamed ? null : responseBytes,
          streamed,
          query,
          ...c.var.logExtra,
        },
        'http.request',
      )
    }
  }
}

function parseIntHeader(v: string | null | undefined): number | null {
  if (!v) return null
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}
