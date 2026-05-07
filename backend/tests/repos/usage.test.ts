import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openDb, type DbHandle } from '../../src/db/client'
import { makeConversationsRepo } from '../../src/db/repos/conversations'
import { makeMessagesRepo } from '../../src/db/repos/messages'
import { makeUsageRepo } from '../../src/db/repos/usage'

describe('usage repo', () => {
  let h: DbHandle
  let conversations: ReturnType<typeof makeConversationsRepo>
  let messages: ReturnType<typeof makeMessagesRepo>
  let usage: ReturnType<typeof makeUsageRepo>
  let convId: string

  beforeEach(() => {
    h = openDb({ path: ':memory:' })
    conversations = makeConversationsRepo(h.db)
    messages = makeMessagesRepo(h.db)
    usage = makeUsageRepo(h.db)
    convId = conversations.create({ title: null }).id
  })

  afterEach(() => {
    h.close()
  })

  function appendAssistant(): string {
    return messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [{ type: 'text', text: 'x' }],
    }).id
  }

  test('record + byMessage round-trip', () => {
    const messageId = appendAssistant()
    usage.record({
      messageId,
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 100,
      outputTokens: 30,
      cacheReadTokens: 5,
      cacheCreateTokens: 2,
      latencyMs: 800,
      costUsd: 0.0042,
    })
    const found = usage.byMessage(messageId)
    expect(found?.inputTokens).toBe(100)
    expect(found?.outputTokens).toBe(30)
    expect(found?.cacheReadTokens).toBe(5)
    expect(found?.cacheCreateTokens).toBe(2)
    expect(found?.latencyMs).toBe(800)
    expect(found?.costUsd).toBeCloseTo(0.0042, 6)
    expect(found?.model).toBe('anthropic/claude-sonnet-4.6')
  })

  test('record rejects duplicate message_id (UNIQUE)', () => {
    const messageId = appendAssistant()
    usage.record({
      messageId,
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      latencyMs: 1,
      costUsd: 0,
    })
    expect(() =>
      usage.record({
        messageId,
        model: 'anthropic/claude-sonnet-4.6',
        inputTokens: 2,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        latencyMs: 2,
        costUsd: 0,
      }),
    ).toThrow()
  })

  test('forConversation aggregates totals + per-message rows', () => {
    const m1 = appendAssistant()
    const m2 = appendAssistant()
    usage.record({
      messageId: m1,
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      latencyMs: 100,
      costUsd: 0.0001,
    })
    usage.record({
      messageId: m2,
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      latencyMs: 200,
      costUsd: 0.00025,
    })
    const agg = usage.forConversation(convId)
    expect(agg.totals.inputTokens).toBe(30)
    expect(agg.totals.outputTokens).toBe(13)
    expect(agg.totals.costUsd).toBeCloseTo(0.00035, 6)
    expect(agg.perMessage).toHaveLength(2)
  })
})
