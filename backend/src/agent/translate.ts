/**
 * Bridge between AI SDK v6 `streamText().fullStream` parts and our SSE wire taxonomy.
 *
 *   `agent/translate.ts` is **stateful per-request** — `TranslateCtx` accumulates
 *   step counters and per-tool start times for `durationMs`. Each call returns
 *   exactly one `SSEEvent | null`. The route's `streamSSE` callback writes any
 *   non-null result and emits the synthesized `start` / `metadata` events itself
 *   (those events are server-side, not provider-side; see spec §4.8).
 *
 * Mapping rules locked by spec §3.2.1 + Step 0.5 #2 + Step 0.6 §3:
 *
 * ─ AI SDK part ─────────  ─ wire event ────────────────────────────────────
 *   text-start              null
 *   text-delta              text-delta { delta: part.text }
 *   text-end                null
 *   reasoning-start         reasoning-start {}
 *   reasoning-delta         reasoning-delta { delta: part.text }
 *   reasoning-end           reasoning-end {}
 *   tool-input-start        tool-call-start { id, name }            (starts duration timer)
 *   tool-input-delta        tool-call-delta { id, partialInput }
 *   tool-input-end          null  (defer to tool-call which has parsed input)
 *   tool-call               tool-call-end { id, input }
 *   tool-result             tool-call-result { id, output, isError, durationMs }
 *   tool-error              tool-call-result { id, output: {...}, isError: true, durationMs }
 *   finish-step (stop)      step { index, reason: 'final' }
 *   finish-step (tool-calls)step { index, reason: 'tool' }
 *   finish-step (length)    error { code: 'UPSTREAM_TRUNCATED', ... }
 *   finish-step (content-…) error { code: 'CONTENT_FILTERED', ... }
 *   finish-step (other)     error { code: 'UPSTREAM_ERROR', ... }
 *   finish (top-level)      null  (caller emits `metadata` after computing latency + cost)
 *   error (top-level)       error { code: 'UPSTREAM_ERROR', message }
 *   abort                   error { code: 'UPSTREAM_TIMEOUT', message }
 *   start | start-step      null
 *   source | file | raw | … null
 *
 * `isError` is **not stored** on `ToolResultPart` (spec §2.4 / Step 0.5 #2) —
 * it's derived here from the result's shape. That's why the storage shape is
 * `output: ToolResultOutput` (a discriminated union) but the wire shape is a
 * convenience boolean for UIs.
 */

import type { ModelMessage } from 'ai'
import type {
  ContentPart as StoredContentPart,
  Message as StoredMessage,
  Role,
  ToolResultOutput,
} from '../db/schema.ts'

// ────────────────────────────────────────────────────────────────────
// Wire types
// ────────────────────────────────────────────────────────────────────
export type SSEEvent = { event: string; data: unknown }

/** Spec §3.2.1 catalog — used by the C-1 contract test. */
export const ALLOWED_SSE_EVENT_NAMES = new Set<string>([
  'start',
  'text-delta',
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
  'tool-call-start',
  'tool-call-delta',
  'tool-call-end',
  'tool-call-result',
  'step',
  'metadata',
  'error',
])

// ────────────────────────────────────────────────────────────────────
// AI SDK part shape — narrowed to what we care about
// ────────────────────────────────────────────────────────────────────
type FinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'tool-calls'
  | 'error'
  | 'other'
  | 'unknown'

export type AnyStreamPart =
  | { type: 'start' }
  | { type: 'start-step'; request: unknown; warnings: unknown }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; text: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-input-start'; id: string; toolName: string }
  | { type: 'tool-input-delta'; id: string; delta: string }
  | { type: 'tool-input-end'; id: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | {
      type: 'tool-result'
      toolCallId: string
      toolName: string
      input: unknown
      output: unknown
    }
  | {
      type: 'tool-error'
      toolCallId: string
      toolName: string
      input?: unknown
      error: unknown
    }
  | {
      type: 'finish-step'
      finishReason: FinishReason
      usage: unknown
    }
  | {
      type: 'finish'
      finishReason: FinishReason
      totalUsage: unknown
    }
  | { type: 'error'; error: unknown }
  | { type: 'abort'; reason?: string }
  | { type: 'source' }
  | { type: 'file' }
  | { type: 'raw' }
  | { type: 'tool-output-denied' }

// ────────────────────────────────────────────────────────────────────
// Per-request translator state
// ────────────────────────────────────────────────────────────────────
export type TranslateCtx = {
  stepIndex: number
  toolStartTimes: Map<string, number>
  /** Monotonic clock injected so tests can assert non-negative durations. */
  now: () => number
  /** When set, a `finish-step` with `finishReason: 'tool-calls'` at exactly this index emits `step{reason:'capped'}` instead of `step{reason:'tool'}`. Reflects `stopWhen: stepCountIs(maxSteps)` having fired. */
  maxSteps?: number
}

export function createTranslateCtx(opts?: { now?: () => number; maxSteps?: number }): TranslateCtx {
  return {
    stepIndex: 0,
    toolStartTimes: new Map(),
    now: opts?.now ?? performance.now.bind(performance),
    maxSteps: opts?.maxSteps,
  }
}

// ────────────────────────────────────────────────────────────────────
// translate(part, ctx)
// ────────────────────────────────────────────────────────────────────
export function translate(part: AnyStreamPart, ctx: TranslateCtx): SSEEvent | null {
  switch (part.type) {
    // No-op surface
    case 'start':
    case 'start-step':
    case 'text-start':
    case 'text-end':
    case 'tool-input-end':
    case 'finish':
    case 'source':
    case 'file':
    case 'raw':
    case 'tool-output-denied':
      return null

    // Text
    case 'text-delta':
      return { event: 'text-delta', data: { delta: part.text } }

    // Reasoning
    case 'reasoning-start':
      return { event: 'reasoning-start', data: {} }
    case 'reasoning-delta':
      return { event: 'reasoning-delta', data: { delta: part.text } }
    case 'reasoning-end':
      return { event: 'reasoning-end', data: {} }

    // Tool call lifecycle
    case 'tool-input-start':
      ctx.toolStartTimes.set(part.id, ctx.now())
      return { event: 'tool-call-start', data: { id: part.id, name: part.toolName } }
    case 'tool-input-delta':
      return {
        event: 'tool-call-delta',
        data: { id: part.id, partialInput: part.delta },
      }
    case 'tool-call':
      return {
        event: 'tool-call-end',
        data: { id: part.toolCallId, input: part.input },
      }
    case 'tool-result': {
      const start = ctx.toolStartTimes.get(part.toolCallId)
      const durationMs = start === undefined ? 0 : Math.max(0, ctx.now() - start)
      ctx.toolStartTimes.delete(part.toolCallId)
      return {
        event: 'tool-call-result',
        data: {
          id: part.toolCallId,
          output: part.output,
          isError: looksLikeError(part.output),
          durationMs: Math.round(durationMs),
        },
      }
    }
    case 'tool-error': {
      const start = ctx.toolStartTimes.get(part.toolCallId)
      const durationMs = start === undefined ? 0 : Math.max(0, ctx.now() - start)
      ctx.toolStartTimes.delete(part.toolCallId)
      return {
        event: 'tool-call-result',
        data: {
          id: part.toolCallId,
          output: errorToOutput(part.error),
          isError: true,
          durationMs: Math.round(durationMs),
        },
      }
    }

    // Step boundaries
    case 'finish-step': {
      ctx.stepIndex += 1
      switch (part.finishReason) {
        case 'stop':
          return { event: 'step', data: { index: ctx.stepIndex, reason: 'final' } }
        case 'tool-calls':
          if (ctx.maxSteps !== undefined && ctx.stepIndex >= ctx.maxSteps) {
            return { event: 'step', data: { index: ctx.stepIndex, reason: 'capped' } }
          }
          return { event: 'step', data: { index: ctx.stepIndex, reason: 'tool' } }
        case 'length':
          return {
            event: 'error',
            data: {
              code: 'UPSTREAM_TRUNCATED',
              message:
                'Upstream model truncated the response (max-tokens reached).',
            },
          }
        case 'content-filter':
          return {
            event: 'error',
            data: {
              code: 'CONTENT_FILTERED',
              message: 'Upstream provider filtered the response for safety.',
            },
          }
        case 'error':
        case 'other':
        case 'unknown':
        default:
          return {
            event: 'error',
            data: {
              code: 'UPSTREAM_ERROR',
              message: `Upstream model finished step with reason "${part.finishReason}".`,
            },
          }
      }
    }

    // Top-level error / abort
    case 'error':
      return {
        event: 'error',
        data: {
          code: 'UPSTREAM_ERROR',
          message:
            part.error instanceof Error
              ? part.error.message
              : typeof part.error === 'string'
                ? part.error
                : 'unknown upstream error',
        },
      }
    case 'abort':
      return {
        event: 'error',
        data: {
          code: 'UPSTREAM_TIMEOUT',
          message: part.reason ?? 'stream aborted',
        },
      }
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
function looksLikeError(output: unknown): boolean {
  if (output === null || typeof output !== 'object') return false
  const o = output as Record<string, unknown>
  // Our tools surface failures as { error: { code, message } }.
  if (typeof o.error === 'object' && o.error !== null) return true
  // The persisted ToolResultOutput shape uses 'error-text' / 'error-json'.
  if (typeof o.type === 'string' && (o.type === 'error-text' || o.type === 'error-json')) {
    return true
  }
  return false
}

function errorToOutput(err: unknown): { message: string; name?: string } {
  if (err instanceof Error) return { message: err.message, name: err.name }
  if (typeof err === 'string') return { message: err }
  return { message: 'tool execution failed' }
}

// ────────────────────────────────────────────────────────────────────
// C-3 — Stored history → AI SDK ModelMessage[]
// ────────────────────────────────────────────────────────────────────
/**
 * Convert the rows returned by `messages.loadHistory(convId)` into the shape
 * expected by `streamText({ messages })`. The stored shape (spec §2.4) and
 * AI SDK's `ModelMessage` are intentionally aligned, so most rows pass through
 * unchanged. The one transformation is that string-form `content` for assistant
 * rows is wrapped in a single `TextPart` since AI SDK assistant content arrays
 * don't accept bare strings.
 */
export function storedToModelMessages(stored: StoredMessage[]): ModelMessage[] {
  return stored.map((row) => toModelMessage(row.role, row.content))
}

function toModelMessage(
  role: Role,
  content: StoredContentPart[] | string,
): ModelMessage {
  if (role === 'user') {
    if (typeof content === 'string') return { role: 'user', content }
    return { role: 'user', content: content as never }
  }
  if (role === 'assistant') {
    if (typeof content === 'string') {
      return { role: 'assistant', content: [{ type: 'text', text: content }] }
    }
    return { role: 'assistant', content: content as never }
  }
  // role === 'tool'
  const parts = (typeof content === 'string'
    ? []
    : content) as Array<{ type: 'tool-result' } & Record<string, unknown>>
  return { role: 'tool', content: parts as never }
}

// Suppress unused import warning when type-only re-export is desired.
export type { ToolResultOutput }
