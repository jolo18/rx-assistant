import type { LanguageModel, ToolSet } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'
import { buildApp as realBuildApp, type AppDeps } from '../../src/index'
import { openDb, type DbHandle } from '../../src/db/client'
import type { Env } from '../../src/env'

const baseEnv: Env = {
  OPENROUTER_API_KEY: 'sk-test',
  OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.6',
  MAX_AGENT_STEPS: 8,
  AI_TIMEOUT_MS: 60_000,
  TOOL_TIMEOUT_MS: 5_000,
  DATABASE_PATH: ':memory:',
  PORT: 8787,
  LOG_LEVEL: 'silent',
  LOG_PRETTY: false,
  CORS_ORIGINS: '*',
}

export type BuildAppOverrides = {
  model: LanguageModel
  tools?: ToolSet
  env?: Partial<Env>
  /** Inject a DB; otherwise an in-memory one is created. */
  db?: DbHandle
  now?: () => number
}

export type TestApp = {
  app: ReturnType<typeof realBuildApp>
  db: DbHandle
  env: Env
  /** When the harness owns the db it returns close() — invoke after each test. */
  close: () => void
}

export function buildApp(overrides: BuildAppOverrides): TestApp {
  const env: Env = { ...baseEnv, ...(overrides.env ?? {}) }
  const ownsDb = !overrides.db
  const db = overrides.db ?? openDb({ path: env.DATABASE_PATH })
  const tools = overrides.tools ?? {}
  const app = realBuildApp({
    env,
    db,
    model: overrides.model,
    tools,
    now: overrides.now,
  })
  return {
    app,
    db,
    env,
    close: () => {
      if (ownsDb) db.close()
    },
  }
}

/** Tiny tool stub — pretends to be drug_info / symptom_lookup for I-2 / I-2e. */
export function stubTool({
  output,
  throws,
  description = 'stub tool for tests',
  inputSchema = z.object({ query: z.string() }).passthrough(),
}: {
  output?: unknown
  throws?: Error | string
  description?: string
  inputSchema?: z.ZodType
}) {
  let calls = 0
  const lastInput: { value: unknown } = { value: undefined }
  const t = tool({
    description,
    inputSchema,
    execute: (async (input: unknown) => {
      calls += 1
      lastInput.value = input
      if (throws !== undefined) {
        throw throws instanceof Error ? throws : new Error(String(throws))
      }
      return output
    }) as never,
  })
  return Object.assign(t, {
    callCount: () => calls,
    lastInput: () => lastInput.value,
  })
}
