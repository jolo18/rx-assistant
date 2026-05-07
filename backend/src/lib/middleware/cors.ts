import { cors as honoCors } from 'hono/cors'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../../types/hono-env.ts'

export type CorsOptions = {
  /** Comma-separated list, or '*'. */
  origins: string
}

export function cors({ origins }: CorsOptions): MiddlewareHandler<AppEnv> {
  if (origins === '*') {
    return honoCors({
      origin: '*',
      allowHeaders: ['content-type', 'x-request-id'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['x-request-id'],
      maxAge: 600,
    })
  }
  const list = origins.split(',').map((o) => o.trim()).filter(Boolean)
  return honoCors({
    origin: list,
    allowHeaders: ['content-type', 'x-request-id'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['x-request-id'],
    maxAge: 600,
    credentials: true,
  })
}
