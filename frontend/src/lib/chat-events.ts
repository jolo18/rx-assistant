/**
 * Chat event schema — mirror of backend §3.2.1 SSE taxonomy. Single source of
 * truth for the typed events the React UI consumes off /api/chat. Keep in sync
 * with the backend's `agent/translate.ts`; mismatches surface as a
 * ChatEventParseError. Pairs with `sse-parse.ts` (transport layer).
 */

import type { SSEFrame } from './sse-parse'

// ── Error codes ──────────────────────────────────────────────────────────────

export const KNOWN_ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_TARGET',
  'NOT_FOUND',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_TRUNCATED',
  'CONTENT_FILTERED',
  'UPSTREAM_ERROR',
  'UNKNOWN_MODEL',
  'INTERNAL',
  'RATE_LIMITED',
  // UI-synthetic — never sent by the backend; emitted by useChatStream when
  // the client connection itself fails before/after receiving any frames.
  'NETWORK_ERROR',
] as const

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number]
// Forward-compat: unknown server-side codes (e.g. a future addition we haven't
// shipped yet) flow through as plain strings rather than crash the parser.
export type ErrorCode = KnownErrorCode | (string & {})

// ── Tool result output (§2.4) ────────────────────────────────────────────────

export type ToolResultOutput =
  | { type: 'json'; value: unknown }
  | { type: 'text'; value: string }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: unknown }
  | {
      type: 'content'
      value: Array<{ type: 'text'; text: string } | { type: 'media'; data: string; mediaType: string }>
    }

// ── Stored content parts (§2.4) ──────────────────────────────────────────────

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: ToolResultOutput }

// ── Step finish reasons ──────────────────────────────────────────────────────

export type StepReason = 'tool' | 'final' | 'capped'

// ── Event payloads (§3.2.1) ──────────────────────────────────────────────────

export type StartEvent = {
  type: 'start'
  messageId: string
  userMessageId: string
  conversationId: string
  model: string
}

export type TextDeltaEvent = { type: 'text-delta'; delta: string }

export type ReasoningStartEvent = { type: 'reasoning-start' }
export type ReasoningDeltaEvent = { type: 'reasoning-delta'; delta: string }
export type ReasoningEndEvent = { type: 'reasoning-end' }

export type ToolCallStartEvent = { type: 'tool-call-start'; id: string; name: string }
export type ToolCallDeltaEvent = { type: 'tool-call-delta'; id: string; partialInput: string }
export type ToolCallEndEvent = { type: 'tool-call-end'; id: string; input: unknown }

export type ToolCallResultEvent = {
  type: 'tool-call-result'
  id: string
  output: ToolResultOutput
  isError: boolean
  durationMs: number
}

export type StepEvent = { type: 'step'; index: number; reason: StepReason }

export type MetadataPayload = {
  type: 'metadata'
  messageId: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  latencyMs: number
  costUsd: number
}

export type ErrorEvent = { type: 'error'; code: ErrorCode; message: string }

export type ChatEvent =
  | StartEvent
  | TextDeltaEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | StepEvent
  | MetadataPayload
  | ErrorEvent

export type ChatEventName = ChatEvent['type']

// ── Parser ───────────────────────────────────────────────────────────────────

export class ChatEventParseError extends Error {
  readonly frame: SSEFrame
  constructor(message: string, frame: SSEFrame) {
    super(message)
    this.name = 'ChatEventParseError'
    this.frame = frame
  }
}

const KNOWN_EVENT_NAMES: ReadonlySet<ChatEventName> = new Set<ChatEventName>([
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

function decode(frame: SSEFrame): Record<string, unknown> {
  try {
    const parsed = JSON.parse(frame.data) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ChatEventParseError(`expected object payload, got ${typeof parsed}`, frame)
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof ChatEventParseError) throw err
    throw new ChatEventParseError(`malformed JSON: ${(err as Error).message}`, frame)
  }
}

function isChatEventName(name: string): name is ChatEventName {
  return (KNOWN_EVENT_NAMES as ReadonlySet<string>).has(name)
}

export function parseChatEvent(frame: SSEFrame): ChatEvent {
  if (!isChatEventName(frame.event)) {
    throw new ChatEventParseError(`unknown event name: ${frame.event}`, frame)
  }

  const data = decode(frame)

  switch (frame.event) {
    case 'start':
      return {
        type: 'start',
        messageId: String(data.messageId),
        userMessageId: String(data.userMessageId),
        conversationId: String(data.conversationId),
        model: String(data.model),
      }
    case 'text-delta':
      return { type: 'text-delta', delta: String(data.delta ?? '') }
    case 'reasoning-start':
      return { type: 'reasoning-start' }
    case 'reasoning-delta':
      return { type: 'reasoning-delta', delta: String(data.delta ?? '') }
    case 'reasoning-end':
      return { type: 'reasoning-end' }
    case 'tool-call-start':
      return {
        type: 'tool-call-start',
        id: String(data.id),
        name: String(data.name),
      }
    case 'tool-call-delta':
      return {
        type: 'tool-call-delta',
        id: String(data.id),
        partialInput: String(data.partialInput ?? ''),
      }
    case 'tool-call-end':
      return {
        type: 'tool-call-end',
        id: String(data.id),
        input: data.input,
      }
    case 'tool-call-result':
      return {
        type: 'tool-call-result',
        id: String(data.id),
        output: data.output as ToolResultOutput,
        isError: Boolean(data.isError),
        durationMs: Number(data.durationMs ?? 0),
      }
    case 'step':
      return {
        type: 'step',
        index: Number(data.index ?? 0),
        reason: data.reason as StepReason,
      }
    case 'metadata':
      return {
        type: 'metadata',
        messageId: String(data.messageId),
        model: String(data.model),
        inputTokens: Number(data.inputTokens ?? 0),
        outputTokens: Number(data.outputTokens ?? 0),
        cacheReadTokens: Number(data.cacheReadTokens ?? 0),
        cacheCreateTokens: Number(data.cacheCreateTokens ?? 0),
        latencyMs: Number(data.latencyMs ?? 0),
        costUsd: Number(data.costUsd ?? 0),
      }
    case 'error':
      return {
        type: 'error',
        code: String(data.code ?? 'INTERNAL') as ErrorCode,
        message: String(data.message ?? ''),
      }
  }
}
