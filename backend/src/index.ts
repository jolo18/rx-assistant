import { Hono } from 'hono'
import type { LanguageModel, ToolSet } from 'ai'
import { parseEnv, type Env } from './env.ts'
import { makeLogger } from './lib/logger.ts'
import { assertKnown } from './lib/pricing.ts'
import { openDb, type DbHandle } from './db/client.ts'
import { healthRoute } from './routes/health.ts'
import { chatRoute } from './routes/chat.ts'
import { createTools } from './agent/tools/index.ts'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

export type AppDeps = {
  env: Env
  db: DbHandle
  model: LanguageModel
  tools: ToolSet
  /** Injected clock — tests pass a deterministic source. */
  now?: () => number
}

export function buildApp(deps: AppDeps) {
  const app = new Hono()
  app.route('/health', healthRoute(deps.db))
  app.route('/api/chat', chatRoute(deps))
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
  const app = buildApp({ env, db, model, tools })
  Bun.serve({ port: env.PORT, fetch: app.fetch })
  log.info(
    { port: env.PORT, model: env.OPENROUTER_MODEL, dbPath: env.DATABASE_PATH },
    'rx-assistant backend listening',
  )
}
