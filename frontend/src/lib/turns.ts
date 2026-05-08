/**
 * History → renderable turns. Backend stores one row per role per turn (user
 * → assistant tool-call → tool tool-result → assistant text). Slice 11
 * collapses each user→…→next-user span into a single Turn whose `assistant`
 * shape is identical to `AssistantMessageInProgress` from useChatStream, so
 * `<AssistantMessage>` can render live and historical turns through the same
 * component.
 */

import type { ContentPart, MetadataPayload } from './chat-events'
import type { AssistantMessageInProgress, ToolCallSlot } from '../hooks/useChatStream'

export type HistoryUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreateTokens?: number
  latencyMs?: number
  costUsd?: number
  model?: string
}

export type HistoryMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: ContentPart[] | string
  position: number
  createdAt: string
  usage?: HistoryUsage
}

export type Turn = {
  user: { id: string; text: string; createdAt: string }
  assistant?: AssistantMessageInProgress
}

export function groupIntoTurns(messages: ReadonlyArray<HistoryMessage>): Turn[] {
  const sorted = [...messages].sort((a, b) => a.position - b.position)
  const turns: Turn[] = []
  let active: Turn | null = null

  for (const msg of sorted) {
    if (msg.role === 'user') {
      active = {
        user: {
          id: msg.id,
          text: extractUserText(msg.content),
          createdAt: msg.createdAt,
        },
      }
      turns.push(active)
      continue
    }

    if (!active) {
      // Defensive: assistant or tool row before any user row — backend should
      // never produce this, but skip rather than crash.
      continue
    }

    if (!active.assistant) {
      active.assistant = blankAssistantTurn(active.user.id, msg)
    }

    if (Array.isArray(msg.content)) {
      applyParts(active.assistant, msg.content)
    }

    if (msg.role === 'assistant') {
      // The terminal assistant row in this turn is what carries the footer
      // metadata. The last assistant row also wins the messageId.
      active.assistant.messageId = msg.id
      if (msg.usage) {
        active.assistant.metadata = synthesizeMetadata(msg.id, msg.usage)
        if (msg.usage.model) active.assistant.model = msg.usage.model
      }
    }
  }

  return turns
}

function blankAssistantTurn(userMessageId: string, firstAssistantOrToolMsg: HistoryMessage): AssistantMessageInProgress {
  return {
    messageId: firstAssistantOrToolMsg.id,
    userMessageId,
    conversationId: '',
    model: '',
    reasoning: { open: false, text: '', done: true },
    toolCalls: [],
    text: '',
    steps: [],
  }
}

function applyParts(turn: AssistantMessageInProgress, parts: ContentPart[]): void {
  for (const part of parts) {
    if (part.type === 'text') {
      turn.text += part.text
    } else if (part.type === 'reasoning') {
      turn.reasoning.text += part.text
    } else if (part.type === 'tool-call') {
      const slot: ToolCallSlot = {
        id: part.toolCallId,
        name: part.toolName,
        // Tool-call without a matching tool-result yet (within the same turn,
        // a settled history always pairs them — but we set a sensible default
        // for malformed data).
        state: 'running',
        partialInput: '',
        input: part.input,
      }
      turn.toolCalls.push(slot)
    } else if (part.type === 'tool-result') {
      const slot = turn.toolCalls.find((c) => c.id === part.toolCallId)
      if (!slot) continue
      slot.output = part.output
      slot.state = part.output.type.startsWith('error-') ? 'complete-error' : 'complete-success'
    }
  }
}

function synthesizeMetadata(messageId: string, usage: HistoryUsage): MetadataPayload {
  return {
    type: 'metadata',
    messageId,
    model: usage.model ?? '',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheCreateTokens: usage.cacheCreateTokens ?? 0,
    latencyMs: usage.latencyMs ?? 0,
    costUsd: usage.costUsd ?? 0,
  }
}

function extractUserText(content: ContentPart[] | string): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}
