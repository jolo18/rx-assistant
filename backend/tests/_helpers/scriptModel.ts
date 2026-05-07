import { MockLanguageModelV3 } from 'ai/test'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'

/**
 * Permissive variant of `LanguageModelV3StreamPart` for tests — `finish.finishReason`
 * may be a bare string (`'stop'`, `'tool-calls'`, etc.) which `normalizeFinishReason`
 * lifts to the canonical `{ unified, raw }` shape before enqueuing.
 */
export type ScriptedPart =
  | LanguageModelV3StreamPart
  | { type: 'finish'; finishReason: string; usage: unknown }

export type ScriptedCall = ScriptedPart[]

export type ScriptedModel = {
  model: LanguageModelV3
  callCounter: { count: number }
  /** Captures abortSignal of every doStream invocation for I-11. */
  signals: Array<AbortSignal | undefined>
  /** Captures the messages prompt of every doStream invocation. */
  prompts: Array<LanguageModelV3CallOptions['prompt']>
}

/**
 * Wrap MockLanguageModelV3 with a counter + per-call scripts. Each call after
 * the last script reuses the final script (cycle for I-3 step-cap tests).
 */
export function scriptModel(...calls: ScriptedCall[]): ScriptedModel {
  const counter = { count: 0 }
  const signals: Array<AbortSignal | undefined> = []
  const prompts: Array<LanguageModelV3CallOptions['prompt']> = []

  const model = new MockLanguageModelV3({
    modelId: 'mock-model',
    provider: 'mock',
    doStream: async (options: LanguageModelV3CallOptions) => {
      const idx = counter.count
      counter.count += 1
      signals.push(options.abortSignal)
      prompts.push(options.prompt)
      const parts = (calls[Math.min(idx, calls.length - 1)] ?? []).map(
        normalizeFinishReason,
      )
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          for (const p of parts) controller.enqueue(p)
          controller.close()
        },
      })
      return { stream }
    },
  })

  return { model, callCounter: counter, signals, prompts }
}

/**
 * AI SDK v3 stream parts use `finishReason: { unified, raw }` (object). Tests
 * write the friendlier string form (`'stop'`, `'tool-calls'`, …); this helper
 * lifts strings to the object shape.
 */
function normalizeFinishReason(p: ScriptedPart): LanguageModelV3StreamPart {
  if (p.type !== 'finish') return p as LanguageModelV3StreamPart
  const fr = (p as { finishReason: unknown }).finishReason
  if (typeof fr === 'string') {
    return {
      ...(p as object),
      finishReason: { unified: fr, raw: undefined },
    } as LanguageModelV3StreamPart
  }
  return p as LanguageModelV3StreamPart
}

/** Build a `usage` payload with sane defaults for the v3 stream `finish` part. */
export function usageOf({
  inputTokens,
  outputTokens,
  cacheRead = 0,
  cacheWrite = 0,
}: {
  inputTokens: number
  outputTokens: number
  cacheRead?: number
  cacheWrite?: number
}) {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens - cacheRead,
      cacheRead,
      cacheWrite,
    },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
    totalTokens: inputTokens + outputTokens,
  }
}
