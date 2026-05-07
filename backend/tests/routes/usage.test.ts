import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { buildApp, type TestApp } from '../_helpers/buildApp'
import type { ContentPart } from '../../src/db/schema'
import { makeConversationsRepo } from '../../src/db/repos/conversations'
import { makeMessagesRepo } from '../../src/db/repos/messages'
import { makeUsageRepo } from '../../src/db/repos/usage'

function newApp(): TestApp {
  return buildApp({ model: {} as never, tools: {} })
}

describe('Usage routes', () => {
  let h: TestApp
  beforeEach(() => {
    h = newApp()
  })
  afterEach(() => {
    h.close()
  })

  test('GET /api/usage/:conversationId aggregates totals + per-message rows', async () => {
    const conversations = makeConversationsRepo(h.db.db)
    const messages = makeMessagesRepo(h.db.db)
    const usage = makeUsageRepo(h.db.db)
    const { id: cid } = conversations.create({ title: null })
    const m1 = messages.append({
      conversationId: cid,
      role: 'assistant',
      content: [{ type: 'text', text: 'a' }] satisfies ContentPart[],
    })
    const m2 = messages.append({
      conversationId: cid,
      role: 'assistant',
      content: [{ type: 'text', text: 'b' }] satisfies ContentPart[],
    })
    usage.record({
      messageId: m1.id,
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      latencyMs: 100,
      costUsd: 0.0001,
    })
    usage.record({
      messageId: m2.id,
      model: 'anthropic/claude-sonnet-4.6',
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 2,
      cacheCreateTokens: 0,
      latencyMs: 200,
      costUsd: 0.00025,
    })

    const res = await h.app.request(`/api/usage/${cid}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      totals: {
        inputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheCreateTokens: number
        costUsd: number
      }
      perMessage: Array<{
        messageId: string
        inputTokens: number
        outputTokens: number
      }>
    }
    expect(body.totals.inputTokens).toBe(30)
    expect(body.totals.outputTokens).toBe(13)
    expect(body.totals.cacheReadTokens).toBe(2)
    expect(body.totals.costUsd).toBeCloseTo(0.00035, 6)
    expect(body.perMessage).toHaveLength(2)
  })

  test('GET /api/usage/:conversationId on unknown id → 404 NOT_FOUND', async () => {
    const res = await h.app.request('/api/usage/01J0000000000000000000000Z')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('GET /api/usage/:conversationId for a conversation with no usage rows → empty totals', async () => {
    const conversations = makeConversationsRepo(h.db.db)
    const { id: cid } = conversations.create({ title: null })
    const res = await h.app.request(`/api/usage/${cid}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      totals: { inputTokens: number; outputTokens: number; costUsd: number }
      perMessage: unknown[]
    }
    expect(body.totals.inputTokens).toBe(0)
    expect(body.totals.outputTokens).toBe(0)
    expect(body.totals.costUsd).toBe(0)
    expect(body.perMessage).toHaveLength(0)
  })
})
