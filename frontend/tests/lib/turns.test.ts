import { describe, expect, test } from 'vitest'
import { groupIntoTurns, type HistoryMessage } from '../../src/lib/turns'

const baseUsage = {
  inputTokens: 12,
  outputTokens: 8,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  latencyMs: 100,
  costUsd: 0.0001,
  model: 'anthropic/claude-sonnet-4.6',
}

function userMsg(id: string, text: string, position: number): HistoryMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    position,
    createdAt: '2026-05-08T10:00:00Z',
  }
}

describe('groupIntoTurns', () => {
  test('returns [] for empty input', () => {
    expect(groupIntoTurns([])).toEqual([])
  })

  test('user-only conversation produces one turn with no assistant', () => {
    const msgs: HistoryMessage[] = [userMsg('u1', 'hello', 0)]
    const turns = groupIntoTurns(msgs)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.user.text).toBe('hello')
    expect(turns[0]!.assistant).toBeUndefined()
  })

  test('user + assistant text-only produces a single turn with text settled', () => {
    const msgs: HistoryMessage[] = [
      userMsg('u1', 'What is ibuprofen?', 0),
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Ibuprofen is an NSAID.' }],
        position: 1,
        createdAt: '2026-05-08T10:00:01Z',
        usage: baseUsage,
      },
    ]
    const turns = groupIntoTurns(msgs)
    expect(turns).toHaveLength(1)
    const t = turns[0]!
    expect(t.user.id).toBe('u1')
    expect(t.assistant?.text).toBe('Ibuprofen is an NSAID.')
    expect(t.assistant?.messageId).toBe('a1')
    expect(t.assistant?.userMessageId).toBe('u1')
    expect(t.assistant?.toolCalls).toHaveLength(0)
    expect(t.assistant?.reasoning.text).toBe('')
    expect(t.assistant?.reasoning.done).toBe(true)
    expect(t.assistant?.metadata?.inputTokens).toBe(12)
    expect(t.assistant?.metadata?.model).toBe('anthropic/claude-sonnet-4.6')
  })

  test('preserves reasoning parts and concatenates with text', () => {
    const msgs: HistoryMessage[] = [
      userMsg('u1', 'q', 0),
      {
        id: 'a1',
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should mention NSAID.' },
          { type: 'text', text: 'Ibuprofen is an NSAID.' },
        ],
        position: 1,
        createdAt: '2026-05-08T10:00:01Z',
        usage: baseUsage,
      },
    ]
    const t = groupIntoTurns(msgs)[0]!
    expect(t.assistant?.reasoning.text).toBe('I should mention NSAID.')
    expect(t.assistant?.text).toBe('Ibuprofen is an NSAID.')
  })

  test('pairs tool-call (assistant) with tool-result (tool) by toolCallId', () => {
    const msgs: HistoryMessage[] = [
      userMsg('u1', 'q', 0),
      {
        id: 'a1',
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tu1',
            toolName: 'drug_info',
            input: { query: 'ibuprofen' },
          },
        ],
        position: 1,
        createdAt: '2026-05-08T10:00:01Z',
      },
      {
        id: 'tr1',
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tu1',
            toolName: 'drug_info',
            output: { type: 'json', value: { name: 'ibuprofen' } },
          },
        ],
        position: 2,
        createdAt: '2026-05-08T10:00:02Z',
      },
      {
        id: 'a2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Ibuprofen treats pain.' }],
        position: 3,
        createdAt: '2026-05-08T10:00:03Z',
        usage: baseUsage,
      },
    ]
    const t = groupIntoTurns(msgs)[0]!
    expect(t.assistant?.toolCalls).toHaveLength(1)
    const tc = t.assistant!.toolCalls[0]!
    expect(tc.id).toBe('tu1')
    expect(tc.name).toBe('drug_info')
    expect(tc.state).toBe('complete-success')
    expect(tc.input).toEqual({ query: 'ibuprofen' })
    expect(tc.output).toEqual({ type: 'json', value: { name: 'ibuprofen' } })

    expect(t.assistant?.text).toBe('Ibuprofen treats pain.')
    // Terminal assistant row carries the messageId for footer rendering
    expect(t.assistant?.messageId).toBe('a2')
  })

  test('marks tool calls with error output as complete-error', () => {
    const msgs: HistoryMessage[] = [
      userMsg('u1', 'q', 0),
      {
        id: 'a1',
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tu1', toolName: 'drug_info', input: { query: 'x' } },
        ],
        position: 1,
        createdAt: '2026-05-08T10:00:01Z',
      },
      {
        id: 'tr1',
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tu1',
            toolName: 'drug_info',
            output: { type: 'error-text', value: 'openFDA 503' },
          },
        ],
        position: 2,
        createdAt: '2026-05-08T10:00:02Z',
      },
      {
        id: 'a2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Sorry, lookup failed.' }],
        position: 3,
        createdAt: '2026-05-08T10:00:03Z',
        usage: baseUsage,
      },
    ]
    const t = groupIntoTurns(msgs)[0]!
    expect(t.assistant?.toolCalls[0]!.state).toBe('complete-error')
  })

  test('splits two turns on the next user-message boundary', () => {
    const msgs: HistoryMessage[] = [
      userMsg('u1', 'first', 0),
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'first answer' }],
        position: 1,
        createdAt: '2026-05-08T10:00:01Z',
        usage: baseUsage,
      },
      userMsg('u2', 'second', 2),
      {
        id: 'a2',
        role: 'assistant',
        content: [{ type: 'text', text: 'second answer' }],
        position: 3,
        createdAt: '2026-05-08T10:00:02Z',
        usage: baseUsage,
      },
    ]
    const turns = groupIntoTurns(msgs)
    expect(turns).toHaveLength(2)
    expect(turns[0]!.user.text).toBe('first')
    expect(turns[0]!.assistant?.text).toBe('first answer')
    expect(turns[1]!.user.text).toBe('second')
    expect(turns[1]!.assistant?.text).toBe('second answer')
  })

  test('handles user content stored as string (per §2.4)', () => {
    const msgs: HistoryMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'plain string content',
        position: 0,
        createdAt: '2026-05-08T10:00:00Z',
      },
    ]
    const t = groupIntoTurns(msgs)[0]!
    expect(t.user.text).toBe('plain string content')
  })

  test('sorts by position when input is shuffled', () => {
    const msgs: HistoryMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        position: 1,
        createdAt: '2026-05-08T10:00:01Z',
        usage: baseUsage,
      },
      userMsg('u1', 'q', 0),
    ]
    const turns = groupIntoTurns(msgs)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.user.id).toBe('u1')
    expect(turns[0]!.assistant?.text).toBe('answer')
  })
})
