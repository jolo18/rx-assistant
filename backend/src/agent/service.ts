/**
 * Multi-step agent loop.
 *
 *   Persist user message → emit `start` → drive AI SDK `streamText({tools, stopWhen})`
 *   → translate fullStream parts to wire SSE → on completion persist
 *   `result.response.messages` (assistant + tool rows) → record usage → emit
 *   `metadata`. Any thrown/abort error funnels into the catch which persists
 *   an empty assistant row (F-12: never half-built content) and emits `error`.
 *
 * Tied to spec §3.2 (chat endpoint), §4.4 (sequence), §4.7 (interface),
 * §4.8 (mid-stream exception handling), §6 (test ids). Step 0.5/0.6
 * resolutions baked in: ToolResultOutput in storage, derived isError in
 * wire, no `done` event, finishReason routing.
 */
import { stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai'
import { newId } from '../lib/ids.ts'
import { httpError, toErrorEvent } from '../lib/errors.ts'
import { noopLogger, type Logger } from '../lib/logger.ts'
import { calculate as calculateCost } from '../lib/pricing.ts'
import type { DB } from '../db/client.ts'
import { makeConversationsRepo } from '../db/repos/conversations.ts'
import { makeMessagesRepo } from '../db/repos/messages.ts'
import { makeUsageRepo } from '../db/repos/usage.ts'
import type { ContentPart, Role, ToolResultOutput } from '../db/schema.ts'
import {
  createTranslateCtx,
  storedToModelMessages,
  translate,
  type AnyStreamPart,
  type SSEEvent,
} from './translate.ts'

export type RunAgentEnv = {
  OPENROUTER_MODEL: string
  MAX_AGENT_STEPS: number
  AI_TIMEOUT_MS: number
}

export type RunAgentDeps = {
  db: DB
  model: LanguageModel
  tools: ToolSet
  env: RunAgentEnv
  now?: () => number
  /** Optional pino logger. Defaults to a silent noop so tests don't have to inject. */
  logger?: Logger
  /** Optional callback invoked when the agent has summary fields ready for the http.request line. */
  setLogExtra?: (extra: Record<string, unknown>) => void
}

export type RunAgentArgs = {
  conversationId?: string
  message: string
  modelOverride?: string
  abortSignal?: AbortSignal
}

type Totals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
}

export async function* runAgent(
  args: RunAgentArgs,
  deps: RunAgentDeps,
): AsyncGenerator<SSEEvent, void, unknown> {
  const { db, model, tools, env } = deps
  const now = deps.now ?? (() => performance.now())
  const log = (deps.logger ?? noopLogger).child({ layer: 'service', service: 'agent' })
  const repoLog = (deps.logger ?? noopLogger).child({ layer: 'repo' })
  const conversations = makeConversationsRepo(db, { logger: repoLog.child({ table: 'conversations' }) })
  const messages = makeMessagesRepo(db, { logger: repoLog.child({ table: 'messages' }) })
  const usage = makeUsageRepo(db, { logger: repoLog.child({ table: 'usage' }) })

  // 1. Resolve / create conversation (FR-14, F-10).
  let conversationId = args.conversationId
  if (conversationId) {
    const c = conversations.get(conversationId)
    if (!c) throw httpError(404, 'NOT_FOUND', `conversation ${conversationId} not found`)
  } else {
    const created = conversations.create({
      title: deriveTitle(args.message),
    })
    conversationId = created.id
  }

  // 2. Persist the user message.
  const userMsg = messages.append({
    conversationId,
    role: 'user',
    content: args.message,
  })

  // 3. Pre-allocate the stream's terminal assistant id. We use it for
  //    `start.messageId` and assign it to the FINAL assistant message at
  //    persistence time so the metadata + usage rows agree.
  const streamMessageId = newId()
  const modelId = args.modelOverride ?? env.OPENROUTER_MODEL

  yield {
    event: 'start',
    data: {
      messageId: streamMessageId,
      userMessageId: userMsg.id,
      conversationId,
      model: modelId,
    },
  }

  log.info(
    {
      op: 'run.start',
      conversationId,
      messageId: streamMessageId,
      userMessageId: userMsg.id,
      model: modelId,
    },
    'agent.run.start',
  )

  // 4. Build messages for the model.
  const stored = messages.loadHistory(conversationId)
  const modelMessages: ModelMessage[] = storedToModelMessages(stored)

  const toolLog = (deps.logger ?? noopLogger).child({ layer: 'tool' })
  const ctx = createTranslateCtx({
    now,
    maxSteps: env.MAX_AGENT_STEPS,
    onToolResult: (info) => {
      toolLog.debug(
        {
          tool: info.toolName,
          toolCallId: info.toolCallId,
          durationMs: info.durationMs,
          isError: info.isError,
        },
        'tool.result',
      )
    },
  })
  const t0 = now()

  // 5. Compose abort signals: caller's request-scoped + AI_TIMEOUT_MS.
  const timeoutController = new AbortController()
  const timeoutTimer = setTimeout(
    () => timeoutController.abort(),
    env.AI_TIMEOUT_MS,
  )
  const signal = combineSignals(args.abortSignal, timeoutController.signal)

  let totals: Totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
  }
  let sawErrorEvent = false

  try {
    const result = streamText({
      model,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(env.MAX_AGENT_STEPS),
      abortSignal: signal,
    })

    for await (const part of result.fullStream as AsyncIterable<AnyStreamPart>) {
      if (part.type === 'finish') {
        totals = readTotals(part as { totalUsage: unknown })
      }
      const ev = translate(part, ctx)
      if (ev) {
        if (ev.event === 'error') sawErrorEvent = true
        yield ev
      }
    }

    // 6. Persist the response.
    const responseSettled = await result.response
    const responseMessages = (responseSettled?.messages ?? []) as Array<{
      role: Role
      content: unknown
    }>

    let lastAssistantId: string | null = null
    if (responseMessages.length === 0) {
      // Defensive — provider yielded nothing. Persist an empty assistant row
      // so the conversation still has a turn (F-12: never half-built content).
      const written = messages.append({
        conversationId,
        role: 'assistant',
        content: [],
        id: streamMessageId,
      })
      lastAssistantId = written.id
    } else {
      const lastAssistantIdx = lastIndexOf(responseMessages, (m) => m.role === 'assistant')
      for (let i = 0; i < responseMessages.length; i++) {
        const m = responseMessages[i]!
        const id = i === lastAssistantIdx ? streamMessageId : newId()
        const written = messages.append({
          conversationId,
          role: m.role,
          content: serializeContent(m.role, m.content),
          id,
        })
        if (m.role === 'assistant') lastAssistantId = written.id
      }
    }

    // 7. Record usage and emit metadata.
    if (!sawErrorEvent && lastAssistantId) {
      const latencyMs = Math.max(0, Math.round(now() - t0))
      const costUsd = calculateCost({
        model: modelId,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheCreateTokens: totals.cacheCreateTokens,
      })
      usage.record({
        messageId: lastAssistantId,
        model: modelId,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheCreateTokens: totals.cacheCreateTokens,
        latencyMs,
        costUsd,
      })
      yield {
        event: 'metadata',
        data: {
          messageId: lastAssistantId,
          model: modelId,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          cacheReadTokens: totals.cacheReadTokens,
          cacheCreateTokens: totals.cacheCreateTokens,
          latencyMs,
          costUsd,
        },
      }

      log.info(
        {
          op: 'run.finish',
          conversationId,
          messageId: lastAssistantId,
          model: modelId,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          cacheReadTokens: totals.cacheReadTokens,
          cacheCreateTokens: totals.cacheCreateTokens,
          costUsd,
          latencyMs,
          steps: ctx.stepIndex,
        },
        'agent.run.finish',
      )
      // Surface chat-extras to the http.request log line.
      deps.setLogExtra?.({
        model: modelId,
        conversationId,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheCreateTokens: totals.cacheCreateTokens,
        costUsd,
        agentSteps: ctx.stepIndex,
      })
    }
  } catch (err) {
    // F-12: persist a single empty-content assistant row to mark the failed turn.
    try {
      messages.append({
        conversationId,
        role: 'assistant',
        content: [],
        id: streamMessageId,
      })
    } catch {
      // If even the recovery insert fails, swallow — we still want to emit
      // the SSE error event so the client gets closure.
    }
    log.error(
      {
        op: 'run.error',
        conversationId,
        messageId: streamMessageId,
        err: err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) },
      },
      'agent.run.error',
    )
    yield { event: 'error', data: toErrorEvent(err) }
  } finally {
    clearTimeout(timeoutTimer)
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function deriveTitle(message: string): string | null {
  const trimmed = message.trim().slice(0, 60)
  return trimmed.length > 0 ? trimmed : null
}

function readTotals(part: { totalUsage: unknown }): Totals {
  const u = part.totalUsage as
    | {
        inputTokens?: number
        outputTokens?: number
        inputTokenDetails?: {
          cacheReadTokens?: number
          cacheWriteTokens?: number
        }
        cachedInputTokens?: number
      }
    | undefined
  return {
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    cacheReadTokens:
      u?.inputTokenDetails?.cacheReadTokens ?? u?.cachedInputTokens ?? 0,
    cacheCreateTokens: u?.inputTokenDetails?.cacheWriteTokens ?? 0,
  }
}

/**
 * AI SDK's response.messages content is already in our spec §2.4 part shape
 * for assistant + tool rows (text, reasoning, tool-call, tool-result with
 * ToolResultOutput). We pass it through, optionally wrapping a stray string
 * payload in a TextPart for assistant rows.
 */
function serializeContent(role: Role, content: unknown): ContentPart[] | string {
  if (typeof content === 'string') {
    if (role === 'user') return content
    return [{ type: 'text', text: content }]
  }
  if (!Array.isArray(content)) return []
  return content.map(normalizePart).filter(Boolean) as ContentPart[]
}

function normalizePart(p: unknown): ContentPart | null {
  if (p === null || typeof p !== 'object') return null
  const part = p as { type?: string } & Record<string, unknown>
  switch (part.type) {
    case 'text':
      return { type: 'text', text: String(part.text ?? '') }
    case 'reasoning':
      return { type: 'reasoning', text: String(part.text ?? '') }
    case 'tool-call':
      return {
        type: 'tool-call',
        toolCallId: String(part.toolCallId ?? ''),
        toolName: String(part.toolName ?? ''),
        input: part.input ?? {},
      }
    case 'tool-result': {
      const output = normalizeToolResultOutput(part.output)
      return {
        type: 'tool-result',
        toolCallId: String(part.toolCallId ?? ''),
        toolName: String(part.toolName ?? ''),
        output,
      }
    }
    default:
      return null
  }
}

function normalizeToolResultOutput(raw: unknown): ToolResultOutput {
  // Already in canonical shape — pass through.
  if (raw && typeof raw === 'object') {
    const r = raw as { type?: string; value?: unknown }
    if (
      r.type === 'json' ||
      r.type === 'text' ||
      r.type === 'error-text' ||
      r.type === 'error-json' ||
      r.type === 'content'
    ) {
      return raw as ToolResultOutput
    }
  }
  // Anything else is wrapped as JSON. If the value reads like our error shape
  // ({error: {...}}) we mark it error-json so the wire `isError` derives
  // correctly later.
  if (raw && typeof raw === 'object' && 'error' in (raw as Record<string, unknown>)) {
    return { type: 'error-json', value: raw }
  }
  return { type: 'json', value: raw }
}

function lastIndexOf<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) return i
  }
  return -1
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const present = signals.filter((s): s is AbortSignal => !!s)
  if (present.length === 0) return new AbortController().signal
  if (present.length === 1) return present[0]!
  return AbortSignal.any(present)
}
