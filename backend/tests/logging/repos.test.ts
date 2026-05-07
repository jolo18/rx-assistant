import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openDb, type DbHandle } from '../../src/db/client'
import { makeConversationsRepo } from '../../src/db/repos/conversations'
import { makeMessagesRepo } from '../../src/db/repos/messages'
import { makeUsageRepo } from '../../src/db/repos/usage'
import { captureLogger } from '../_helpers/captureLogger'

describe('repo layer logging', () => {
  let h: DbHandle
  beforeEach(() => {
    h = openDb({ path: ':memory:' })
  })
  afterEach(() => {
    h.close()
  })

  test('conversations.create + .get + .list emit one debug line each', () => {
    const { logger, lines } = captureLogger('debug')
    const repo = makeConversationsRepo(h.db, { logger })

    const { id } = repo.create({ title: 't' })
    repo.get(id)
    repo.list()

    const ops = lines
      .filter((l) => l.layer === 'repo' && l.table === 'conversations')
      .map((l) => l.op)
    expect(ops).toEqual(['create', 'get', 'list'])
    for (const l of lines) {
      if (l.layer === 'repo') {
        expect(typeof l.durationMs).toBe('number')
      }
    }
  })

  test('messages.append + .deleteUserTurn emit logged ops with durations', () => {
    const { logger, lines } = captureLogger('debug')
    const conversations = makeConversationsRepo(h.db, { logger })
    const repo = makeMessagesRepo(h.db, { logger })
    const { id: cid } = conversations.create({ title: null })
    const u1 = repo.append({ conversationId: cid, role: 'user', content: 'q' })
    repo.append({ conversationId: cid, role: 'assistant', content: [{ type: 'text', text: 'a' }] })
    repo.deleteUserTurn(u1.id)

    const ops = lines
      .filter((l) => l.layer === 'repo' && l.table === 'messages')
      .map((l) => l.op)
    expect(ops).toContain('append')
    expect(ops).toContain('deleteUserTurn')
    for (const l of lines.filter((l) => l.layer === 'repo' && l.table === 'messages')) {
      expect(typeof l.durationMs).toBe('number')
    }
  })

  test('usage.record + .byMessage + .forConversation log structured ops', () => {
    const { logger, lines } = captureLogger('debug')
    const conversations = makeConversationsRepo(h.db, { logger })
    const messages = makeMessagesRepo(h.db, { logger })
    const usage = makeUsageRepo(h.db, { logger })

    const { id: cid } = conversations.create({ title: null })
    const m = messages.append({
      conversationId: cid,
      role: 'assistant',
      content: [{ type: 'text', text: 'x' }],
    })
    usage.record({
      messageId: m.id,
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      latencyMs: 100,
      costUsd: 0.0001,
    })
    usage.byMessage(m.id)
    usage.forConversation(cid)

    const ops = lines
      .filter((l) => l.layer === 'repo' && l.table === 'usage')
      .map((l) => l.op)
    expect(ops).toEqual(['record', 'byMessage', 'forConversation'])
  })

  test('repos default to silent logger when no opts.logger is passed', () => {
    // No logger injected — calling repo methods must not throw and not log.
    const repo = makeConversationsRepo(h.db)
    repo.create({ title: 'x' })
    repo.list()
    // Nothing observable here; the assertion is that we got this far.
    expect(true).toBe(true)
  })
})
