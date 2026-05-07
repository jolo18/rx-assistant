import { Hono } from 'hono'
import type { DbHandle } from '../db/client.ts'
import { makeConversationsRepo } from '../db/repos/conversations.ts'
import { makeUsageRepo } from '../db/repos/usage.ts'
import { httpError, toHttpEnvelope } from '../lib/errors.ts'
import type { AppEnv } from '../types/hono-env.ts'

export function usageRoute(handle: DbHandle) {
  const app = new Hono<AppEnv>()
  const conversations = makeConversationsRepo(handle.db)
  const usage = makeUsageRepo(handle.db)

  app.get('/:conversationId', (c) => {
    const id = c.req.param('conversationId')
    if (!conversations.get(id)) {
      return c.json(
        toHttpEnvelope(httpError(404, 'NOT_FOUND', `conversation ${id} not found`)),
        404,
      )
    }
    const agg = usage.forConversation(id)
    return c.json({
      totals: agg.totals,
      perMessage: agg.perMessage.map((u) => ({
        messageId: u.messageId,
        model: u.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheCreateTokens: u.cacheCreateTokens,
        latencyMs: u.latencyMs,
        costUsd: u.costUsd,
        createdAt: u.createdAt,
      })),
    })
  })

  return app
}
