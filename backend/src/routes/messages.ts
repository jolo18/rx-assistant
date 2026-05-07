import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { DbHandle } from '../db/client.ts'
import { makeMessagesRepo } from '../db/repos/messages.ts'
import { HttpError, toHttpEnvelope } from '../lib/errors.ts'
import type { AppEnv } from '../types/hono-env.ts'

export function messagesRoute(handle: DbHandle) {
  const app = new Hono<AppEnv>()
  const messages = makeMessagesRepo(handle.db)

  /**
   * Step 0.6 §3 — DELETE accepts only user-message ids and cascades through
   * the rest of the turn. The repo throws HttpError with code NOT_FOUND
   * (unknown id) or INVALID_TARGET (assistant/tool id).
   */
  app.delete('/:id', (c) => {
    const id = c.req.param('id')
    try {
      messages.deleteUserTurn(id)
      return c.body(null, 204 as ContentfulStatusCode)
    } catch (err) {
      if (err instanceof HttpError) {
        return c.json(toHttpEnvelope(err), err.status as ContentfulStatusCode)
      }
      return c.json(toHttpEnvelope(err), 500)
    }
  })

  return app
}
