import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { buildApp, type TestApp } from '../_helpers/buildApp'
import type { ContentPart } from '../../src/db/schema'
import { makeConversationsRepo } from '../../src/db/repos/conversations'
import { makeMessagesRepo } from '../../src/db/repos/messages'
import { makeUsageRepo } from '../../src/db/repos/usage'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

function newApp(): TestApp {
  return buildApp({ model: {} as never, tools: {} })
}

function seedTurn(h: TestApp): { conversationId: string; assistantId: string; userId: string } {
  const conversations = makeConversationsRepo(h.db.db)
  const messages = makeMessagesRepo(h.db.db)
  const usage = makeUsageRepo(h.db.db)

  const { id: conversationId } = conversations.create({ title: 'ibuprofen' })
  const user = messages.append({
    conversationId,
    role: 'user',
    content: 'What is ibuprofen?',
  })
  messages.append({
    conversationId,
    role: 'assistant',
    content: [
      { type: 'tool-call', toolCallId: 'tu1', toolName: 'drug_info', input: { query: 'ibuprofen' } },
    ] satisfies ContentPart[],
  })
  messages.append({
    conversationId,
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'tu1',
        toolName: 'drug_info',
        output: { type: 'json', value: { name: 'Advil' } },
      },
    ] satisfies ContentPart[],
  })
  const assistant = messages.append({
    conversationId,
    role: 'assistant',
    content: [{ type: 'text', text: 'Ibuprofen is an NSAID.' }] satisfies ContentPart[],
  })
  usage.record({
    messageId: assistant.id,
    model: 'anthropic/claude-sonnet-4.6',
    inputTokens: 130,
    outputTokens: 30,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    latencyMs: 800,
    costUsd: 0.0015,
  })
  return { conversationId, assistantId: assistant.id, userId: user.id }
}

describe('Conversation routes', () => {
  let h: TestApp
  beforeEach(() => {
    h = newApp()
  })
  afterEach(() => {
    h.close()
  })

  test('GET /api/conversations/:id returns full conversation with content + usage on final assistant (I-5)', async () => {
    const { conversationId, assistantId } = seedTurn(h)
    const res = await h.app.request(`/api/conversations/${conversationId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: string
      title: string | null
      createdAt: number
      updatedAt: number
      messages: Array<{
        id: string
        role: string
        content: ContentPart[] | string
        position: number
        createdAt: number
        usage?: {
          inputTokens: number
          outputTokens: number
          costUsd: number
          model: string
        }
      }>
    }
    expect(body.id).toBe(conversationId)
    expect(body.title).toBe('ibuprofen')
    expect(body.messages).toHaveLength(4)
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(body.messages[0]?.content).toBe('What is ibuprofen?')
    const lastAssistant = body.messages[3]!
    expect(lastAssistant.id).toBe(assistantId)
    expect(lastAssistant.usage?.inputTokens).toBe(130)
    expect(lastAssistant.usage?.outputTokens).toBe(30)
    expect(lastAssistant.usage?.model).toBe('anthropic/claude-sonnet-4.6')
    // Other messages have no usage block
    expect(body.messages[0]?.usage).toBeUndefined()
    expect(body.messages[1]?.usage).toBeUndefined()
    expect(body.messages[2]?.usage).toBeUndefined()
  })

  test('GET /api/conversations/:id → 404 NOT_FOUND for unknown id (F-10)', async () => {
    const res = await h.app.request('/api/conversations/01J0000000000000000000000Z')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('GET /api/conversations lists by updated_at desc', async () => {
    const conversations = makeConversationsRepo(h.db.db)
    const a = conversations.create({ title: 'a' })
    await new Promise((r) => setTimeout(r, 5))
    const b = conversations.create({ title: 'b' })
    await new Promise((r) => setTimeout(r, 5))
    conversations.touch(a.id)

    const res = await h.app.request('/api/conversations')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string; title: string; updatedAt: number }>
    expect(body.map((c) => c.id)).toEqual([a.id, b.id])
    expect(body[0]?.title).toBe('a')
    // List shape excludes messages — keep it lightweight.
    expect((body[0] as Record<string, unknown>).messages).toBeUndefined()
  })

  test('POST /api/conversations creates a conversation (optional title) → 201 with id', async () => {
    const res = await h.app.request('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hi' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; title: string | null }
    expect(body.id).toMatch(ULID_RE)
    expect(body.title).toBe('hi')
  })

  test('POST /api/conversations with empty body creates with null title', async () => {
    const res = await h.app.request('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; title: string | null }
    expect(body.id).toMatch(ULID_RE)
    expect(body.title).toBeNull()
  })

  test('POST /api/conversations rejects oversize title with 400 INVALID_INPUT', async () => {
    const res = await h.app.request('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(200) }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  test('DELETE /api/conversations/:id → 204 + cascades to messages + usage', async () => {
    const { conversationId } = seedTurn(h)
    const res = await h.app.request(`/api/conversations/${conversationId}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)

    const reloaded = await h.app.request(`/api/conversations/${conversationId}`)
    expect(reloaded.status).toBe(404)

    // FK cascade — no orphan rows anywhere.
    const messageCount = h.db.sqlite
      .query<{ n: number }, [string]>(
        'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?',
      )
      .get(conversationId)!.n
    expect(messageCount).toBe(0)
    const usageCount = h.db.sqlite
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM usage WHERE message_id NOT IN (SELECT id FROM messages)",
      )
      .get()!.n
    expect(usageCount).toBe(0)
  })

  test('DELETE /api/conversations/:id on unknown id is idempotent (204)', async () => {
    const res = await h.app.request('/api/conversations/01J0000000000000000000000Z', {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
  })
})
