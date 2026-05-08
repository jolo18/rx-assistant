import { describe, expect, test } from 'vitest'
import { parseSSE } from '../../src/lib/sse-parse'
import { parseChatEvent, type ChatEvent } from '../../src/lib/chat-events'

function streamFromString(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

describe('SSE → ChatEvent round-trip on §3.2.1 example stream', () => {
  test('parses the documented happy-path stream into typed events', async () => {
    const wire = [
      'event: start',
      'data: {"messageId":"01J","userMessageId":"01U","conversationId":"01C","model":"anthropic/claude-sonnet-4.6"}',
      '',
      'event: text-delta',
      'data: {"delta":"Ibuprofen"}',
      '',
      'event: tool-call-start',
      'data: {"id":"toolu_abc","name":"drug_info"}',
      '',
      'event: tool-call-delta',
      'data: {"id":"toolu_abc","partialInput":"{\\"q\\":\\"ibu"}',
      '',
      'event: tool-call-end',
      'data: {"id":"toolu_abc","input":{"query":"ibuprofen"}}',
      '',
      'event: tool-call-result',
      'data: {"id":"toolu_abc","output":{"type":"json","value":{"name":"ibuprofen"}},"isError":false,"durationMs":124}',
      '',
      'event: step',
      'data: {"index":0,"reason":"tool"}',
      '',
      'event: metadata',
      'data: {"messageId":"01J","model":"anthropic/claude-sonnet-4.6","inputTokens":12,"outputTokens":8,"cacheReadTokens":0,"cacheCreateTokens":0,"latencyMs":842,"costUsd":0.0001}',
      '',
      '',
    ].join('\n')

    const events: ChatEvent[] = []
    for await (const frame of parseSSE(streamFromString(wire))) {
      events.push(parseChatEvent(frame))
    }

    expect(events.map((e) => e.type)).toEqual([
      'start',
      'text-delta',
      'tool-call-start',
      'tool-call-delta',
      'tool-call-end',
      'tool-call-result',
      'step',
      'metadata',
    ])

    const meta = events.at(-1)!
    if (meta.type !== 'metadata') throw new Error()
    expect(meta.latencyMs).toBe(842)
  })

  test('parses an error-terminated stream', async () => {
    const wire = [
      'event: start',
      'data: {"messageId":"01J","userMessageId":"01U","conversationId":"01C","model":"x"}',
      '',
      'event: text-delta',
      'data: {"delta":"part"}',
      '',
      'event: error',
      'data: {"code":"UPSTREAM_TIMEOUT","message":"Took too long"}',
      '',
      '',
    ].join('\n')

    const events: ChatEvent[] = []
    for await (const frame of parseSSE(streamFromString(wire))) {
      events.push(parseChatEvent(frame))
    }

    expect(events.map((e) => e.type)).toEqual(['start', 'text-delta', 'error'])
    const last = events.at(-1)!
    if (last.type !== 'error') throw new Error()
    expect(last.code).toBe('UPSTREAM_TIMEOUT')
  })
})
