import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { DbHandle } from '../db/client.ts'
import { makeConversationsRepo } from '../db/repos/conversations.ts'
import { makeMessagesRepo } from '../db/repos/messages.ts'
import { makeUsageRepo } from '../db/repos/usage.ts'
import { httpError, toHttpEnvelope } from '../lib/errors.ts'
import { CreateConversationSchema } from '../lib/validate.ts'
import type { AppEnv } from '../types/hono-env.ts'

export function conversationsRoute(handle: DbHandle) {
  const app = new Hono<AppEnv>()
  const conversations = makeConversationsRepo(handle.db)
  const messages = makeMessagesRepo(handle.db)
  const usage = makeUsageRepo(handle.db)

  // GET /api/conversations — list, sorted by updatedAt desc.
  app.get('/', (c) => {
    const list = conversations.list().map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    return c.json(list)
  })

  // POST /api/conversations — { title? } → 201 { id, title, createdAt, updatedAt }.
  app.post('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const parsed = CreateConversationSchema.safeParse(body)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'request body failed validation',
            details: parsed.error.issues,
          },
        },
        400,
      )
    }
    const { id } = conversations.create({ title: parsed.data.title ?? null })
    const row = conversations.get(id)!
    return c.json(
      {
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      201,
    )
  })

  // GET /api/conversations/:id — full conversation with messages + per-message usage.
  app.get('/:id', (c) => {
    const id = c.req.param('id')
    const row = conversations.get(id)
    if (!row) {
      return c.json(
        toHttpEnvelope(httpError(404, 'NOT_FOUND', `conversation ${id} not found`)),
        404,
      )
    }
    const msgs = messages.loadHistory(id).map((m) => {
      const u = m.role === 'assistant' ? usage.byMessage(m.id) : null
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        position: m.position,
        createdAt: m.createdAt,
        ...(u
          ? {
              usage: {
                model: u.model,
                inputTokens: u.inputTokens,
                outputTokens: u.outputTokens,
                cacheReadTokens: u.cacheReadTokens,
                cacheCreateTokens: u.cacheCreateTokens,
                latencyMs: u.latencyMs,
                costUsd: u.costUsd,
              },
            }
          : {}),
      }
    })
    return c.json({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messages: msgs,
    })
  })

  // DELETE /api/conversations/:id — idempotent. FK CASCADE handles messages + usage.
  app.delete('/:id', (c) => {
    const id = c.req.param('id')
    conversations.delete(id)
    return c.body(null, 204 as ContentfulStatusCode)
  })

  return app
}
