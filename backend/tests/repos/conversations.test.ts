import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openDb, type DbHandle } from '../../src/db/client'
import { makeConversationsRepo } from '../../src/db/repos/conversations'
import { makeMessagesRepo } from '../../src/db/repos/messages'
import { makeUsageRepo } from '../../src/db/repos/usage'

describe('conversations repo', () => {
  let h: DbHandle
  let conversations: ReturnType<typeof makeConversationsRepo>
  let messages: ReturnType<typeof makeMessagesRepo>
  let usage: ReturnType<typeof makeUsageRepo>

  beforeEach(() => {
    h = openDb({ path: ':memory:' })
    conversations = makeConversationsRepo(h.db)
    messages = makeMessagesRepo(h.db)
    usage = makeUsageRepo(h.db)
  })

  afterEach(() => {
    h.close()
  })

  test('create returns id and persists row', () => {
    const { id } = conversations.create({ title: 'first chat' })
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/) // ULID
    const found = conversations.get(id)
    expect(found?.id).toBe(id)
    expect(found?.title).toBe('first chat')
    expect(found?.createdAt).toBeGreaterThan(0)
    expect(found?.updatedAt).toBe(found?.createdAt)
  })

  test('get returns null for unknown id (F-10)', () => {
    expect(conversations.get('01J0000000000000000000000000')).toBeNull()
  })

  test('list returns conversations sorted by updatedAt desc', async () => {
    const a = conversations.create({ title: 'a' })
    await new Promise((r) => setTimeout(r, 5))
    const b = conversations.create({ title: 'b' })
    await new Promise((r) => setTimeout(r, 5))
    conversations.touch(a.id)

    const list = conversations.list()
    expect(list.map((c) => c.id)).toEqual([a.id, b.id])
  })

  test('delete cascades messages and usage rows', () => {
    const { id: convId } = conversations.create({ title: null })
    const { id: msgId } = messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
    })
    usage.record({
      messageId: msgId,
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      latencyMs: 50,
      costUsd: 0.0001,
    })

    conversations.delete(convId)

    expect(conversations.get(convId)).toBeNull()
    expect(messages.loadHistory(convId)).toEqual([])
    expect(usage.byMessage(msgId)).toBeNull()
  })

  test('touch bumps updatedAt without altering createdAt', async () => {
    const { id } = conversations.create({ title: 't' })
    const before = conversations.get(id)!
    await new Promise((r) => setTimeout(r, 10))
    conversations.touch(id)
    const after = conversations.get(id)!
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
  })
})
