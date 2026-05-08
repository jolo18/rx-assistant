import { describe, expect, test } from 'vitest'
import {
  parseChatEvent,
  type ChatEvent,
  type ErrorCode,
  ChatEventParseError,
} from '../../src/lib/chat-events'

describe('parseChatEvent — typed shapes for every §3.2.1 event', () => {
  test('start', () => {
    const ev = parseChatEvent({
      event: 'start',
      data: '{"messageId":"01J","userMessageId":"01U","conversationId":"01C","model":"anthropic/claude-sonnet-4.6"}',
    })
    expect(ev.type).toBe('start')
    if (ev.type !== 'start') throw new Error('narrowing failed')
    expect(ev.messageId).toBe('01J')
    expect(ev.userMessageId).toBe('01U')
    expect(ev.conversationId).toBe('01C')
    expect(ev.model).toBe('anthropic/claude-sonnet-4.6')
  })

  test('text-delta', () => {
    const ev = parseChatEvent({ event: 'text-delta', data: '{"delta":"Ibu"}' })
    expect(ev.type).toBe('text-delta')
    if (ev.type !== 'text-delta') throw new Error()
    expect(ev.delta).toBe('Ibu')
  })

  test('reasoning-start, reasoning-delta, reasoning-end', () => {
    expect(parseChatEvent({ event: 'reasoning-start', data: '{}' }).type).toBe('reasoning-start')
    const mid = parseChatEvent({ event: 'reasoning-delta', data: '{"delta":"…thinking"}' })
    expect(mid.type).toBe('reasoning-delta')
    if (mid.type !== 'reasoning-delta') throw new Error()
    expect(mid.delta).toBe('…thinking')
    expect(parseChatEvent({ event: 'reasoning-end', data: '{}' }).type).toBe('reasoning-end')
  })

  test('tool-call-start / -delta / -end', () => {
    const start = parseChatEvent({
      event: 'tool-call-start',
      data: '{"id":"t1","name":"drug_info"}',
    })
    expect(start.type).toBe('tool-call-start')
    if (start.type !== 'tool-call-start') throw new Error()
    expect(start.id).toBe('t1')
    expect(start.name).toBe('drug_info')

    const delta = parseChatEvent({
      event: 'tool-call-delta',
      data: '{"id":"t1","partialInput":"{\\"q\\":\\"ibu"}',
    })
    expect(delta.type).toBe('tool-call-delta')
    if (delta.type !== 'tool-call-delta') throw new Error()
    expect(delta.id).toBe('t1')
    expect(delta.partialInput).toBe('{"q":"ibu')

    const end = parseChatEvent({
      event: 'tool-call-end',
      data: '{"id":"t1","input":{"query":"ibuprofen"}}',
    })
    expect(end.type).toBe('tool-call-end')
    if (end.type !== 'tool-call-end') throw new Error()
    expect(end.id).toBe('t1')
    expect(end.input).toEqual({ query: 'ibuprofen' })
  })

  test('tool-call-result with isError + durationMs', () => {
    const ev = parseChatEvent({
      event: 'tool-call-result',
      data: '{"id":"t1","output":{"type":"json","value":{"name":"ibuprofen"}},"isError":false,"durationMs":124}',
    })
    expect(ev.type).toBe('tool-call-result')
    if (ev.type !== 'tool-call-result') throw new Error()
    expect(ev.id).toBe('t1')
    expect(ev.isError).toBe(false)
    expect(ev.durationMs).toBe(124)
    expect(ev.output).toEqual({ type: 'json', value: { name: 'ibuprofen' } })
  })

  test('step (final / tool / capped)', () => {
    for (const reason of ['final', 'tool', 'capped'] as const) {
      const ev = parseChatEvent({ event: 'step', data: `{"index":0,"reason":"${reason}"}` })
      expect(ev.type).toBe('step')
      if (ev.type !== 'step') throw new Error()
      expect(ev.reason).toBe(reason)
      expect(ev.index).toBe(0)
    }
  })

  test('metadata (terminal happy-path)', () => {
    const ev = parseChatEvent({
      event: 'metadata',
      data: '{"messageId":"01J","model":"anthropic/claude-sonnet-4.6","inputTokens":12,"outputTokens":8,"cacheReadTokens":0,"cacheCreateTokens":0,"latencyMs":842,"costUsd":0.0001}',
    })
    expect(ev.type).toBe('metadata')
    if (ev.type !== 'metadata') throw new Error()
    expect(ev.inputTokens).toBe(12)
    expect(ev.outputTokens).toBe(8)
    expect(ev.cacheReadTokens).toBe(0)
    expect(ev.cacheCreateTokens).toBe(0)
    expect(ev.latencyMs).toBe(842)
    expect(ev.costUsd).toBeCloseTo(0.0001)
  })

  test('error events for every documented ErrorCode', () => {
    const codes: ErrorCode[] = [
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
    ]
    for (const code of codes) {
      const ev = parseChatEvent({
        event: 'error',
        data: JSON.stringify({ code, message: `boom ${code}` }),
      })
      expect(ev.type).toBe('error')
      if (ev.type !== 'error') throw new Error()
      expect(ev.code).toBe(code)
      expect(ev.message).toBe(`boom ${code}`)
    }
  })

  test('preserves unrecognized error codes as strings (forward-compat)', () => {
    const ev = parseChatEvent({
      event: 'error',
      data: '{"code":"FUTURE_CODE","message":"unknown"}',
    })
    expect(ev.type).toBe('error')
    if (ev.type !== 'error') throw new Error()
    // Forward-compat: unknown codes flow through as string
    expect(ev.code).toBe('FUTURE_CODE')
  })

  test('throws ChatEventParseError for unknown event names', () => {
    expect(() => parseChatEvent({ event: 'never-shipped', data: '{}' })).toThrow(ChatEventParseError)
  })

  test('throws ChatEventParseError for malformed JSON in data', () => {
    expect(() => parseChatEvent({ event: 'text-delta', data: 'not json' })).toThrow(ChatEventParseError)
  })

  test('exhaustive ChatEvent union compile-time check', () => {
    // Compile-time exhaustiveness — if a new event is added without a case,
    // this switch fails to typecheck.
    function eventName(ev: ChatEvent): string {
      switch (ev.type) {
        case 'start':
        case 'text-delta':
        case 'reasoning-start':
        case 'reasoning-delta':
        case 'reasoning-end':
        case 'tool-call-start':
        case 'tool-call-delta':
        case 'tool-call-end':
        case 'tool-call-result':
        case 'step':
        case 'metadata':
        case 'error':
          return ev.type
      }
    }
    expect(eventName({ type: 'reasoning-start' })).toBe('reasoning-start')
  })
})
