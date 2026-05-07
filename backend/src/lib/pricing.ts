import { UnknownModelError } from './errors.ts'

/**
 * Per-million-token USD prices, keyed by OpenRouter model id.
 *
 * Step 0.5 #6 / Step 0.6 — boot-time `assertKnown(env.OPENROUTER_MODEL)` rejects
 * unknown ids before the server binds; runtime `calculate(...)` throws
 * `UnknownModelError` on cache miss rather than silently returning 0.
 *
 * Prices reflect Anthropic + OpenRouter public rates as of authoring; revisit
 * when changing the default model. OpenRouter applies a small markup on top of
 * provider pricing — for take-home accuracy we use the underlying provider rate.
 */
export type ModelPricing = {
  /** USD per million input tokens. */
  inputPerMTok: number
  /** USD per million output tokens. */
  outputPerMTok: number
  /** USD per million cache-read tokens (typically a fraction of input). */
  cacheReadPerMTok: number
  /** USD per million cache-create tokens (typically a multiple of input). */
  cacheCreatePerMTok: number
}

export const KNOWN_MODELS: Record<string, ModelPricing> = {
  // ─ Anthropic via OpenRouter ──────────────────────────────────────
  'anthropic/claude-sonnet-4.6': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheCreatePerMTok: 3.75,
  },
  'anthropic/claude-sonnet-4.5': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheCreatePerMTok: 3.75,
  },
  'anthropic/claude-haiku-4.5': {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheCreatePerMTok: 1.25,
  },

  // ─ DeepSeek via OpenRouter ───────────────────────────────────────
  // Public published rates as of authoring; verify against
  // https://openrouter.ai/models when picking. assertKnown() will fail-fast
  // on a missing entry, so adding new ids is cheap.
  'deepseek/deepseek-chat': {
    inputPerMTok: 0.14,
    outputPerMTok: 0.28,
    cacheReadPerMTok: 0.014,
    cacheCreatePerMTok: 0.14,
  },
  'deepseek/deepseek-chat-v3.1': {
    inputPerMTok: 0.27,
    outputPerMTok: 1.1,
    cacheReadPerMTok: 0.027,
    cacheCreatePerMTok: 0.27,
  },
  'deepseek/deepseek-v3.2-exp': {
    inputPerMTok: 0.27,
    outputPerMTok: 0.4,
    cacheReadPerMTok: 0.027,
    cacheCreatePerMTok: 0.27,
  },
  'deepseek/deepseek-v3.2': {
    inputPerMTok: 0.27,
    outputPerMTok: 0.4,
    cacheReadPerMTok: 0.027,
    cacheCreatePerMTok: 0.27,
  },
  'deepseek/deepseek-v3.1-terminus': {
    inputPerMTok: 0.23,
    outputPerMTok: 0.9,
    cacheReadPerMTok: 0.023,
    cacheCreatePerMTok: 0.23,
  },
  'deepseek/deepseek-v4-flash': {
    inputPerMTok: 0.2,
    outputPerMTok: 0.8,
    cacheReadPerMTok: 0.02,
    cacheCreatePerMTok: 0.2,
  },
  'deepseek/deepseek-v4-pro': {
    inputPerMTok: 0.4,
    outputPerMTok: 1.5,
    cacheReadPerMTok: 0.04,
    cacheCreatePerMTok: 0.4,
  },
  'deepseek/deepseek-r1': {
    inputPerMTok: 0.55,
    outputPerMTok: 2.19,
    cacheReadPerMTok: 0.055,
    cacheCreatePerMTok: 0.55,
  },
}

export { UnknownModelError } from './errors.ts'

export type CalculateInput = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreateTokens?: number
}

export function calculate(input: CalculateInput): number {
  const pricing = KNOWN_MODELS[input.model]
  if (!pricing) throw new UnknownModelError(input.model)
  const M = 1_000_000
  return (
    (input.inputTokens * pricing.inputPerMTok) / M +
    (input.outputTokens * pricing.outputPerMTok) / M +
    ((input.cacheReadTokens ?? 0) * pricing.cacheReadPerMTok) / M +
    ((input.cacheCreateTokens ?? 0) * pricing.cacheCreatePerMTok) / M
  )
}

export function assertKnown(model: string): void {
  if (!KNOWN_MODELS[model]) throw new UnknownModelError(model)
}
