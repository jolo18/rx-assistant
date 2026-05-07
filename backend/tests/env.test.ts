import { describe, expect, test } from 'bun:test'
import { parseEnv } from '../src/env'

describe('parseEnv', () => {
  test('rejects missing OPENROUTER_API_KEY (F-13)', () => {
    expect(() => parseEnv({})).toThrow(/OPENROUTER_API_KEY/)
  })

  test('rejects empty OPENROUTER_API_KEY (F-13)', () => {
    expect(() => parseEnv({ OPENROUTER_API_KEY: '' })).toThrow(/OPENROUTER_API_KEY/)
  })

  test('loads with documented defaults when only required vars present (NFR-11)', () => {
    const env = parseEnv({ OPENROUTER_API_KEY: 'sk-test' })
    expect(env.OPENROUTER_API_KEY).toBe('sk-test')
    expect(env.OPENROUTER_MODEL).toBe('anthropic/claude-sonnet-4.6')
    expect(env.MAX_AGENT_STEPS).toBe(8)
    expect(env.AI_TIMEOUT_MS).toBe(60_000)
    expect(env.TOOL_TIMEOUT_MS).toBe(5_000)
    expect(env.DATABASE_PATH).toBe('./data/app.db')
    expect(env.PORT).toBe(8787)
    expect(env.LOG_LEVEL).toBe('info')
  })

  test('honors Step 0.6 env key names', () => {
    const env = parseEnv({
      OPENROUTER_API_KEY: 'sk-test',
      OPENROUTER_MODEL: 'openai/gpt-5',
      DATABASE_PATH: '/tmp/test.db',
      TOOL_TIMEOUT_MS: '3000',
      AI_TIMEOUT_MS: '120000',
      PORT: '9000',
    })
    expect(env.OPENROUTER_MODEL).toBe('openai/gpt-5')
    expect(env.DATABASE_PATH).toBe('/tmp/test.db')
    expect(env.TOOL_TIMEOUT_MS).toBe(3_000)
    expect(env.AI_TIMEOUT_MS).toBe(120_000)
    expect(env.PORT).toBe(9_000)
  })

  test('ignores legacy env names (ANTHROPIC_MODEL, DATABASE_URL)', () => {
    const env = parseEnv({
      OPENROUTER_API_KEY: 'sk-test',
      ANTHROPIC_MODEL: 'should-be-ignored',
      DATABASE_URL: 'file:./should-be-ignored',
    })
    expect(env.OPENROUTER_MODEL).toBe('anthropic/claude-sonnet-4.6')
    expect(env.DATABASE_PATH).toBe('./data/app.db')
  })

  test('rejects invalid LOG_LEVEL', () => {
    expect(() =>
      parseEnv({ OPENROUTER_API_KEY: 'sk-test', LOG_LEVEL: 'verbose' }),
    ).toThrow(/LOG_LEVEL/)
  })

  test('rejects non-numeric PORT', () => {
    expect(() =>
      parseEnv({ OPENROUTER_API_KEY: 'sk-test', PORT: 'eight-thousand' }),
    ).toThrow(/PORT/)
  })
})
