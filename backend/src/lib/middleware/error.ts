import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from '../../types/hono-env.ts'
import { HttpError, toHttpEnvelope } from '../errors.ts'
import { noopLogger } from '../logger.ts'

/**
 * Global `app.onError` handler.
 *
 * - HttpError → preserve status, warn-level log, stable `{error: {code, message}}` envelope.
 * - AbortError (client disconnect surfacing past route try/catch) → 499-ish; info log; no body.
 * - Anything else → 500 INTERNAL, error-level log with stack. NFR-3: process must not crash.
 *
 * F-7: pre-stream DB read failures hit this path because the chat route surfaces
 * them via `runAgent` synchronous throw before opening the SSE stream.
 */
export function errorHandler(err: Error, c: Context<AppEnv>): Response {
  const log = c.var.logger ?? noopLogger
  if (err instanceof HttpError) {
    log.warn({ layer: 'http', code: err.code, status: err.status }, 'http.error')
    return c.json(toHttpEnvelope(err), err.status as ContentfulStatusCode)
  }
  if (err.name === 'AbortError') {
    log.info({ layer: 'http' }, 'http.aborted')
    // Stream is already gone; nothing meaningful to send back.
    return new Response(null, { status: 499 as ContentfulStatusCode })
  }
  log.error(
    {
      layer: 'http',
      err: { name: err.name, message: err.message, stack: err.stack },
    },
    'http.unhandled',
  )
  return c.json(toHttpEnvelope(err), 500)
}
