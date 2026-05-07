import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { LanguageModel, ToolSet } from 'ai'
import type { Env } from '../env.ts'
import type { DbHandle } from '../db/client.ts'
import { runAgent } from '../agent/service.ts'
import { ChatRequestSchema } from '../lib/validate.ts'
import { HttpError, toErrorEvent, toHttpEnvelope } from '../lib/errors.ts'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from '../types/hono-env.ts'

export type ChatRouteDeps = {
  env: Env
  db: DbHandle
  model: LanguageModel
  tools: ToolSet
  now?: () => number
}

export function chatRoute(deps: ChatRouteDeps) {
  const baseRunAgentEnv = {
    OPENROUTER_MODEL: deps.env.OPENROUTER_MODEL,
    MAX_AGENT_STEPS: deps.env.MAX_AGENT_STEPS,
    AI_TIMEOUT_MS: deps.env.AI_TIMEOUT_MS,
  }
  const app = new Hono<AppEnv>()

  app.post('/', async (c) => {
    // 1. Parse & validate body BEFORE opening any stream (I-4 → JSON 400).
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(
        { error: { code: 'INVALID_INPUT', message: 'request body must be valid JSON' } },
        400,
      )
    }
    const parsed = ChatRequestSchema.safeParse(body)
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

    // 2. Peek the first generator step. If conversation resolution throws
    //    (F-10 unknown id → 404), surface it as JSON before opening SSE.
    const gen = runAgent(
      { ...parsed.data, abortSignal: c.req.raw.signal },
      {
        db: deps.db.db,
        model: deps.model,
        tools: deps.tools,
        env: baseRunAgentEnv,
        now: deps.now,
        logger: c.var.logger,
        setLogExtra: (extra) => {
          c.set('logExtra', { ...(c.var.logExtra ?? {}), ...extra })
        },
      },
    )
    let first: IteratorResult<{ event: string; data: unknown }>
    try {
      first = await gen.next()
    } catch (err) {
      if (err instanceof HttpError) {
        return c.json(toHttpEnvelope(err), err.status as ContentfulStatusCode)
      }
      return c.json(toHttpEnvelope(err), 500)
    }

    // 3. Stream out: replay the first event, then drain the rest.
    return streamSSE(c, async (stream) => {
      if (!first.done && first.value) {
        await stream.writeSSE({
          event: first.value.event,
          data: JSON.stringify(first.value.data ?? {}),
        })
      }
      try {
        for await (const ev of gen) {
          await stream.writeSSE({
            event: ev.event,
            data: JSON.stringify(ev.data ?? {}),
          })
        }
      } catch (err) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify(toErrorEvent(err)),
        })
      }
    })
  })

  return app
}
