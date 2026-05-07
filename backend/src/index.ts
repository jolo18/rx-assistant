import { Hono } from 'hono'
import { parseEnv, type Env } from './env.ts'
import { makeLogger } from './lib/logger.ts'
import { assertKnown } from './lib/pricing.ts'
import { openDb, type DbHandle } from './db/client.ts'
import { healthRoute } from './routes/health.ts'

export function buildApp(env: Env, db: DbHandle) {
  const app = new Hono()
  app.route('/health', healthRoute(db))
  // Future slices mount /api/* here.
  void env // reserved for slices that consume env in the request lifecycle
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
  const app = buildApp(env, db)
  Bun.serve({ port: env.PORT, fetch: app.fetch })
  log.info(
    { port: env.PORT, model: env.OPENROUTER_MODEL, dbPath: env.DATABASE_PATH },
    'rx-assistant backend listening',
  )
}
