import { describe, expect, test } from 'bun:test'
import {
  KNOWN_MODELS,
  UnknownModelError,
  assertKnown,
  calculate,
} from '../../src/lib/pricing'

describe('pricing.calculate (U-1)', () => {
  test('claude-sonnet-4.6: 1M input + 1M output → expected USD', () => {
    const cost = calculate({
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    // $3/MTok in + $15/MTok out = $18 for the canonical model.
    expect(cost).toBeCloseTo(18, 6)
  })

  test('zero tokens → zero cost', () => {
    const cost = calculate({
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 0,
      outputTokens: 0,
    })
    expect(cost).toBe(0)
  })

  test('cacheReadTokens contribute at the discounted rate', () => {
    const baseline = calculate({
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 1_000_000,
      outputTokens: 0,
    })
    const withCache = calculate({
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    })
    // Cache reads cost less per token than fresh input — total must be > baseline
    // but < baseline + baseline.
    expect(withCache).toBeGreaterThan(baseline)
    expect(withCache).toBeLessThan(baseline * 2)
  })

  test('unknown model id throws UnknownModelError (Step 0.5 #6)', () => {
    expect(() =>
      calculate({ model: 'unknown/model', inputTokens: 100, outputTokens: 50 }),
    ).toThrow(UnknownModelError)
  })

  test('UnknownModelError carries the offending model id', () => {
    let err: unknown
    try {
      calculate({ model: 'unknown/model', inputTokens: 1, outputTokens: 1 })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(UnknownModelError)
    expect((err as UnknownModelError).model).toBe('unknown/model')
  })
})

describe('pricing.assertKnown (Step 0.5 #6 boot invariant)', () => {
  test('passes for the documented default OPENROUTER_MODEL', () => {
    expect(() => assertKnown('anthropic/claude-sonnet-4.6')).not.toThrow()
  })

  test('throws UnknownModelError for unknown ids', () => {
    expect(() => assertKnown('unknown/model')).toThrow(UnknownModelError)
  })

  test('every entry in KNOWN_MODELS resolves via calculate without throwing', () => {
    for (const model of Object.keys(KNOWN_MODELS)) {
      expect(() =>
        calculate({ model, inputTokens: 100, outputTokens: 100 }),
      ).not.toThrow()
    }
  })

  test('KNOWN_MODELS contains both Sonnet 4.5 and 4.6 (Step 0.6)', () => {
    // Property names contain dots — use array form so Bun doesn't interpret as a path.
    expect(Object.keys(KNOWN_MODELS)).toContain('anthropic/claude-sonnet-4.6')
    expect(Object.keys(KNOWN_MODELS)).toContain('anthropic/claude-sonnet-4.5')
  })
})
