import { Hono } from 'hono'
import type { LanguageModel, ToolSet } from 'ai'
import { parseEnv, type Env } from './env.ts'
import { makeLogger, noopLogger, type Logger } from './lib/logger.ts'
import { assertKnown } from './lib/pricing.ts'
import { openDb, type DbHandle } from './db/client.ts'
import { healthRoute } from './routes/health.ts'
import { chatRoute } from './routes/chat.ts'
import { conversationsRoute } from './routes/conversations.ts'
import { messagesRoute } from './routes/messages.ts'
import { usageRoute } from './routes/usage.ts'
import { createTools } from './agent/tools/index.ts'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { requestId } from './lib/middleware/requestId.ts'
import { logger as loggerMiddleware } from './lib/middleware/logger.ts'
import { errorHandler } from './lib/middleware/error.ts'
import { cors } from './lib/middleware/cors.ts'
import type { AppEnv } from './types/hono-env.ts'

export type AppDeps = {
  env: Env
  db: DbHandle
  model: LanguageModel
  tools: ToolSet
  /** Injected clock — tests pass a deterministic source. */
  now?: () => number
  /** Optional logger — defaults to a silent noop so tests don't have to inject. */
  logger?: Logger
}

export function buildApp(deps: AppDeps) {
  const log = deps.logger ?? noopLogger
  const app = new Hono<AppEnv>()

  // Mount order: cors → requestId → logger → routes → app.onError last.
  app.use('*', cors({ origins: deps.env.CORS_ORIGINS }))
  app.use('*', requestId())
  app.use('*', loggerMiddleware(log))

  app.route('/health', healthRoute(deps.db))
  app.route('/api/chat', chatRoute(deps))
  app.route('/api/conversations', conversationsRoute(deps.db))
  app.route('/api/messages', messagesRoute(deps.db))
  app.route('/api/usage', usageRoute(deps.db))

  app.onError(errorHandler)
  return app
}

/** Boot-time invariants — Step 0.5 #6 / Step 0.6 F-13. Throws if anything is wrong. */
export function validateBootInvariants(env: Env): void {
  assertKnown(env.OPENROUTER_MODEL)
}

if (import.meta.main) {
  const env = parseEnv()
  validateBootInvariants(env)
  const log = makeLogger(env)
  const db = openDb({ path: env.DATABASE_PATH })
  const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })
  const model = openrouter.chat(env.OPENROUTER_MODEL)
  const tools = createTools(env)
  const app = buildApp({ env, db, model, tools, logger: log })
  Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
    // SSE responses outlive Bun's default 10s idle window. We rely on
    // env.AI_TIMEOUT_MS + per-tool budgets (TOOL_TIMEOUT_MS) to cap upstream
    // work; idleTimeout=0 means no socket-level timeout. F-2 / F-11 still
    // cover hung upstreams + client disconnects.
    idleTimeout: 0,
  })
  log.info(
    {
      layer: 'boot',
      port: env.PORT,
      model: env.OPENROUTER_MODEL,
      dbPath: env.DATABASE_PATH,
      logPretty: env.LOG_PRETTY,
    },
    'boot.listening',
  )
}
