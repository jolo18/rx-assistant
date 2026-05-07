import { Hono } from 'hono'
import type { DbHandle } from '../db/client.ts'
import { pingDb } from '../db/client.ts'
import type { AppEnv } from '../types/hono-env.ts'

export function healthRoute(handle: DbHandle) {
  const app = new Hono<AppEnv>()
  app.get('/', (c) => {
    const reachable = pingDb(handle.sqlite)
    if (!reachable) {
      return c.json(
        { status: 'degraded', migrations: 'applied', db: 'unreachable' },
        503,
      )
    }
    // Migrations always run on openDb() with shouldMigrate=true; if we got here, they applied.
    return c.json({ status: 'ok', migrations: 'applied', db: 'reachable' })
  })
  return app
}
