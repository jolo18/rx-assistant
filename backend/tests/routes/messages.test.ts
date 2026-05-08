import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { buildApp, type TestApp } from '../_helpers/buildApp'
import type { ContentPart } from '../../src/db/schema'
import { makeConversationsRepo } from '../../src/db/repos/conversations'
import { makeMessagesRepo } from '../../src/db/repos/messages'
import { storedToModelMessages } from '../../src/agent/translate'

function newApp(): TestApp {
  return buildApp({ model: {} as never, tools: {} })
}

function seedMultiTurn(h: TestApp): {
  conversationId: string
  u1: string
  a1: string
  t1: string
  a2: string
  u2: string
  a3: string
} {
  const conversations = makeConversationsRepo(h.db.db)
  const messages = makeMessagesRepo(h.db.db)
  const { id: conversationId } = conversations.create({ title: null })
  const u1 = messages.append({ conversationId, role: 'user', content: 'q1' })
  const a1 = messages.append({
    conversationId,
    role: 'assistant',
    content: [
      { type: 'tool-call', toolCallId: 'tu1', toolName: 'drug_info', input: { query: 'x' } },
    ] satisfies ContentPart[],
  })
  const t1 = messages.append({
    conversationId,
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'tu1',
        toolName: 'drug_info',
        output: { type: 'json', value: { ok: true } },
      },
    ] satisfies ContentPart[],
  })
  const a2 = messages.append({
    conversationId,
    role: 'assistant',
    content: [{ type: 'text', text: 'answer 1' }] satisfies ContentPart[],
  })
  const u2 = messages.append({ conversationId, role: 'user', content: 'q2' })
  const a3 = messages.append({
    conversationId,
    role: 'assistant',
    content: [{ type: 'text', text: 'answer 2' }] satisfies ContentPart[],
  })
  return {
    conversationId,
    u1: u1.id,
    a1: a1.id,
    t1: t1.id,
    a2: a2.id,
    u2: u2.id,
    a3: a3.id,
  }
}

describe('Message routes (Step 0.6 §3 DELETE policy)', () => {
  let h: TestApp
  beforeEach(() => {
    h = newApp()
  })
  afterEach(() => {
    h.close()
  })

  test('DELETE /api/messages/:id on a user message cascades from that turn through end of conversation (I-6)', async () => {
    const ids = seedMultiTurn(h)
    // Deleting u1 should remove every message at position >= u1.position —
    // i.e. u1, a1, t1, a2, u2, a3 — leaving the conversation empty.
    const res = await h.app.request(`/api/messages/${ids.u1}`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    const remaining = h.db.sqlite
      .query<{ id: string; role: string; position: number }, [string]>(
        'SELECT id, role, position FROM messages WHERE conversation_id = ? ORDER BY position',
      )
      .all(ids.conversationId)

    expect(remaining).toEqual([])
  })

  test('DELETE /api/messages/:id on a middle user message keeps earlier turns untouched (no renumber)', async () => {
    const ids = seedMultiTurn(h)
    // Deleting u2 should keep u1, a1, t1, a2 (positions 0..3, unchanged) and
    // remove u2, a3.
    const res = await h.app.request(`/api/messages/${ids.u2}`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    const remaining = h.db.sqlite
      .query<{ id: string; role: string; position: number }, [string]>(
        'SELECT id, role, position FROM messages WHERE conversation_id = ? ORDER BY position',
      )
      .all(ids.conversationId)

    expect(remaining.map((r) => r.id)).toEqual([ids.u1, ids.a1, ids.t1, ids.a2])
    expect(remaining.map((r) => r.position)).toEqual([0, 1, 2, 3])
  })

  test('Post-delete conversation round-trips through storedToModelMessages with no orphan tool_use (NFR-8)', async () => {
    const ids = seedMultiTurn(h)
    await h.app.request(`/api/messages/${ids.u1}`, { method: 'DELETE' })
    const stored = makeMessagesRepo(h.db.db).loadHistory(ids.conversationId)
    const model = storedToModelMessages(stored)
    // Walk the resulting ModelMessage[] — collect tool-call ids and tool-result ids.
    const toolCalls: string[] = []
    const toolResults: string[] = []
    for (const m of model) {
      if (Array.isArray(m.content)) {
        for (const part of m.content as Array<{
          type: string
          toolCallId?: string
        }>) {
          if (part.type === 'tool-call' && part.toolCallId) toolCalls.push(part.toolCallId)
          if (part.type === 'tool-result' && part.toolCallId) toolResults.push(part.toolCallId)
        }
      }
    }
    // Every tool-call has a matching tool-result.
    for (const id of toolCalls) {
      expect(toolResults).toContain(id)
    }
  })

  test('DELETE /api/messages/:id on assistant id → 400 INVALID_TARGET', async () => {
    const ids = seedMultiTurn(h)
    const res = await h.app.request(`/api/messages/${ids.a2}`, { method: 'DELETE' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_TARGET')
  })

  test('DELETE /api/messages/:id on tool id → 400 INVALID_TARGET', async () => {
    const ids = seedMultiTurn(h)
    const res = await h.app.request(`/api/messages/${ids.t1}`, { method: 'DELETE' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_TARGET')
  })

  test('DELETE /api/messages/:id on unknown id → 404 NOT_FOUND', async () => {
    const res = await h.app.request('/api/messages/01J0000000000000000000000Z', {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('DELETE last user-turn (no following user) leaves earlier conversation intact', async () => {
    const ids = seedMultiTurn(h)
    // Deleting u2 removes u2 + a3, leaves u1, a1, t1, a2.
    const res = await h.app.request(`/api/messages/${ids.u2}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    const rows = h.db.sqlite
      .query<{ id: string; position: number }, [string]>(
        'SELECT id, position FROM messages WHERE conversation_id = ? ORDER BY position',
      )
      .all(ids.conversationId)
    expect(rows.map((r) => r.id)).toEqual([ids.u1, ids.a1, ids.t1, ids.a2])
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3])
  })
})
