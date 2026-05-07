import { describe, expect, test } from 'bun:test'
import { validateBootInvariants } from '../src/index'
import { UnknownModelError } from '../src/lib/errors'

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

describe('validateBootInvariants (Step 0.5 #6 / F-13)', () => {
  test('passes for the default OPENROUTER_MODEL', () => {
    expect(() => validateBootInvariants(baseEnv)).not.toThrow()
  })

  test('throws UnknownModelError when OPENROUTER_MODEL is not in pricing.ts', () => {
    expect(() =>
      validateBootInvariants({ ...baseEnv, OPENROUTER_MODEL: 'unknown/model' }),
    ).toThrow(UnknownModelError)
  })
})
