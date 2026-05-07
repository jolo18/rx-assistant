import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../../types/hono-env.ts'
import { newId } from '../ids.ts'

/**
 * Reads `X-Request-Id` if the client supplied one (correlation across
 * services), otherwise generates a ULID. Sets `c.var.requestId` and echoes
 * the id back as a response header so the client can stash it for support.
 */
export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id')?.trim()
    const id = incoming && incoming.length > 0 && incoming.length <= 128 ? incoming : newId()
    c.set('requestId', id)
    c.header('x-request-id', id)
    await next()
  }
}
