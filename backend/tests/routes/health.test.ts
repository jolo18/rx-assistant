import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { buildApp } from '../../src/index'
import { openDb, type DbHandle } from '../../src/db/client'

const baseEnv = {
  OPENROUTER_API_KEY: 'sk-test',
  OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.6',
  MAX_AGENT_STEPS: 8,
  AI_TIMEOUT_MS: 60_000,
  TOOL_TIMEOUT_MS: 5_000,
  DATABASE_PATH: ':memory:',
  PORT: 8787,
  LOG_LEVEL: 'silent' as const,
}

type HealthBody = {
  status: 'ok' | 'degraded'
  migrations: 'applied' | 'pending'
  db: 'reachable' | 'unreachable'
}

describe('GET /health (FR-15, I-7)', () => {
  let h: DbHandle

  beforeEach(() => {
    h = openDb({ path: ':memory:' })
  })
  afterEach(() => {
    h.close()
  })

  test('returns 200 with status: ok, migrations: applied, db: reachable', async () => {
    const app = buildApp({ env: baseEnv, db: h, model: {} as never, tools: {} })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as HealthBody
    expect(body).toEqual({ status: 'ok', migrations: 'applied', db: 'reachable' })
  })

  test('content-type is application/json', async () => {
    const app = buildApp({ env: baseEnv, db: h, model: {} as never, tools: {} })
    const res = await app.request('/health')
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  test('returns 503 when DB is unreachable', async () => {
    const app = buildApp({ env: baseEnv, db: h, model: {} as never, tools: {} })
    h.sqlite.close() // simulate DB outage
    const res = await app.request('/health')
    expect(res.status).toBe(503)
    const body = (await res.json()) as HealthBody
    expect(body.status).toBe('degraded')
    expect(body.db).toBe('unreachable')
  })
})
