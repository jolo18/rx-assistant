import type { Logger } from '../lib/logger.ts'

/**
 * Hono context variable shape — typed once here so routes / middleware can
 * `new Hono<AppEnv>()` and get autocomplete for `c.var.requestId`,
 * `c.var.logger`, and `c.var.logExtra`.
 *
 * Slice 8: requestId middleware sets `requestId`; logger middleware sets
 * `logger` (a child of the root pino logger with `requestId` baked in) and
 * `logExtra` (a mutable bag merged into the terminal `http.request` line).
 */
export type AppEnv = {
  Variables: {
    requestId: string
    logger: Logger
    logExtra: Record<string, unknown>
  }
}
