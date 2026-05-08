import { useCallback, useReducer, useRef } from 'react'
import { parseSSE } from '../lib/sse-parse'
import {
  ChatEventParseError,
  parseChatEvent,
  type ChatEvent,
  type ErrorCode,
  type MetadataPayload,
  type StepReason,
} from '../lib/chat-events'

export type ToolCallState = 'pending' | 'running' | 'complete-success' | 'complete-error'

export type ToolCallSlot = {
  id: string
  name: string
  state: ToolCallState
  partialInput: string
  input?: unknown
  output?: unknown
  durationMs?: number
}

export type AssistantMessageInProgress = {
  messageId: string
  userMessageId: string
  conversationId: string
  model: string
  reasoning: { open: boolean; text: string; done: boolean }
  toolCalls: ToolCallSlot[]
  text: string
  steps: Array<{ index: number; reason: StepReason }>
  metadata?: MetadataPayload
}

export type ChatStreamState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'streaming'; assistant: AssistantMessageInProgress }
  | { phase: 'done'; assistant: AssistantMessageInProgress }
  | { phase: 'error'; code: ErrorCode; message: string }

export type ChatStreamHandle = {
  state: ChatStreamState
  send: (message: string) => { tempUserMessageId: string }
  abort: () => void
}

type Action =
  | { kind: 'submit' }
  | { kind: 'event'; event: ChatEvent }
  | { kind: 'network-error'; message: string }
  | { kind: 'reset' }

const INITIAL: ChatStreamState = { phase: 'idle' }

function blankAssistant(ev: {
  messageId: string
  userMessageId: string
  conversationId: string
  model: string
}): AssistantMessageInProgress {
  return {
    messageId: ev.messageId,
    userMessageId: ev.userMessageId,
    conversationId: ev.conversationId,
    model: ev.model,
    reasoning: { open: false, text: '', done: false },
    toolCalls: [],
    text: '',
    steps: [],
  }
}

function reducer(state: ChatStreamState, action: Action): ChatStreamState {
  switch (action.kind) {
    case 'reset':
      return INITIAL
    case 'submit':
      return { phase: 'submitting' }
    case 'network-error':
      return { phase: 'error', code: 'NETWORK_ERROR', message: action.message }
    case 'event':
      return applyEvent(state, action.event)
  }
}

function applyEvent(state: ChatStreamState, event: ChatEvent): ChatStreamState {
  if (event.type === 'start') {
    return { phase: 'streaming', assistant: blankAssistant(event) }
  }
  if (event.type === 'error') {
    return { phase: 'error', code: event.code, message: event.message }
  }
  // All remaining events require an in-flight assistant. Drop frames that
  // arrive before `start` (defensive — backend should never emit this).
  if (state.phase !== 'streaming') return state

  const a = state.assistant
  switch (event.type) {
    case 'reasoning-start':
      return { phase: 'streaming', assistant: { ...a, reasoning: { ...a.reasoning, open: true } } }
    case 'reasoning-delta':
      return {
        phase: 'streaming',
        assistant: { ...a, reasoning: { ...a.reasoning, text: a.reasoning.text + event.delta } },
      }
    case 'reasoning-end':
      return {
        phase: 'streaming',
        assistant: { ...a, reasoning: { ...a.reasoning, done: true, open: false } },
      }
    case 'text-delta':
      return { phase: 'streaming', assistant: { ...a, text: a.text + event.delta } }
    case 'tool-call-start': {
      const slot: ToolCallSlot = {
        id: event.id,
        name: event.name,
        state: 'pending',
        partialInput: '',
      }
      return { phase: 'streaming', assistant: { ...a, toolCalls: [...a.toolCalls, slot] } }
    }
    case 'tool-call-delta': {
      const toolCalls = a.toolCalls.map((c) =>
        c.id === event.id ? { ...c, partialInput: c.partialInput + event.partialInput } : c,
      )
      return { phase: 'streaming', assistant: { ...a, toolCalls } }
    }
    case 'tool-call-end': {
      const toolCalls = a.toolCalls.map<ToolCallSlot>((c) =>
        c.id === event.id ? { ...c, input: event.input, state: 'running' } : c,
      )
      return { phase: 'streaming', assistant: { ...a, toolCalls } }
    }
    case 'tool-call-result': {
      const finalState: ToolCallState = event.isError ? 'complete-error' : 'complete-success'
      const toolCalls = a.toolCalls.map<ToolCallSlot>((c) =>
        c.id === event.id
          ? { ...c, output: event.output, durationMs: event.durationMs, state: finalState }
          : c,
      )
      return { phase: 'streaming', assistant: { ...a, toolCalls } }
    }
    case 'step':
      return {
        phase: 'streaming',
        assistant: { ...a, steps: [...a.steps, { index: event.index, reason: event.reason }] },
      }
    case 'metadata':
      return {
        phase: 'done',
        assistant: { ...a, metadata: event, reasoning: { ...a.reasoning, open: false } },
      }
  }
}

function genTempId(): string {
  // Browser UI surface — 8 random chars is plenty for an in-tab optimistic id.
  const rand = Math.random().toString(36).slice(2, 10)
  return `temp-${Date.now().toString(36)}-${rand}`
}

export function useChatStream(opts: { conversationId?: string } = {}): ChatStreamHandle {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const conversationId = opts.conversationId

  const send = useCallback(
    (message: string) => {
      // Cancel any prior in-flight stream before starting a new one.
      abortRef.current?.abort()

      const tempUserMessageId = genTempId()
      dispatch({ kind: 'submit' })

      const ac = new AbortController()
      abortRef.current = ac

      void streamChat({ conversationId, message }, ac.signal, dispatch)

      return { tempUserMessageId }
    },
    [conversationId],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return { state, send, abort }
}

async function streamChat(
  body: { conversationId?: string; message: string },
  signal: AbortSignal,
  dispatch: (a: Action) => void,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (signal.aborted) return
    dispatch({ kind: 'network-error', message: (err as Error).message || 'network error' })
    return
  }

  if (!response.ok || !response.body) {
    dispatch({ kind: 'network-error', message: `HTTP ${response.status}` })
    return
  }

  try {
    for await (const frame of parseSSE(response.body)) {
      try {
        const event = parseChatEvent(frame)
        dispatch({ kind: 'event', event })
      } catch (err) {
        if (err instanceof ChatEventParseError) {
          // Malformed frame — skip and keep reading; the next event may settle
          // the stream into a known terminal state (metadata or error).
          continue
        }
        throw err
      }
    }
  } catch (err) {
    if (signal.aborted) return
    dispatch({ kind: 'network-error', message: (err as Error).message || 'stream error' })
  }
}
