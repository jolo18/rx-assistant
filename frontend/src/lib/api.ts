/**
 * Fetch wrappers for the backend's JSON endpoints. Streaming `/api/chat`
 * lives in useChatStream — this module only covers the conversation /
 * message / usage routes from spec §3.3.
 *
 * Errors surface as `ApiError` carrying the structured `{ code, message }`
 * envelope from §3.4, so callers can distinguish 404 / INVALID_INPUT etc.
 * Network failures throw a synthetic `NETWORK_ERROR` for symmetry with the
 * SSE error union.
 */

import type { ContentPart, ErrorCode } from './chat-events'

export type ConversationSummary = {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export type StoredMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: ContentPart[] | string
  position: number
  createdAt: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheCreateTokens?: number
    latencyMs?: number
    costUsd?: number
    model?: string
  }
}

export type ConversationDetail = ConversationSummary & {
  messages: StoredMessage[]
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown
  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    throw new ApiError('NETWORK_ERROR', (err as Error).message || 'network error', 0)
  }

  // 204 No Content has no body — return undefined cast as T.
  if (response.status === 204) {
    return undefined as unknown as T
  }

  if (!response.ok) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ApiError('INTERNAL', `HTTP ${response.status}`, response.status)
    }
    const env = (payload as { error?: { code?: string; message?: string; details?: unknown } }).error
    throw new ApiError(
      (env?.code as ErrorCode) ?? 'INTERNAL',
      env?.message ?? `HTTP ${response.status}`,
      response.status,
      env?.details,
    )
  }

  return (await response.json()) as T
}

// ── Conversations ────────────────────────────────────────────────────────────

export function listConversations(): Promise<ConversationSummary[]> {
  return request<ConversationSummary[]>('/api/conversations')
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`)
}

export function createConversation(title?: string): Promise<ConversationSummary> {
  return request<ConversationSummary>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(title ? { title } : {}),
  })
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── Messages ─────────────────────────────────────────────────────────────────

export function deleteMessage(id: string): Promise<void> {
  return request<void>(`/api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
