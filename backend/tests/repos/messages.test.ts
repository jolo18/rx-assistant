import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openDb, type DbHandle } from '../../src/db/client'
import { makeConversationsRepo } from '../../src/db/repos/conversations'
import { makeMessagesRepo } from '../../src/db/repos/messages'

describe('messages repo', () => {
  let h: DbHandle
  let conversations: ReturnType<typeof makeConversationsRepo>
  let messages: ReturnType<typeof makeMessagesRepo>
  let convId: string

  beforeEach(() => {
    h = openDb({ path: ':memory:' })
    conversations = makeConversationsRepo(h.db)
    messages = makeMessagesRepo(h.db)
    convId = conversations.create({ title: null }).id
  })

  afterEach(() => {
    h.close()
  })

  test('append assigns monotonically increasing positions starting at 0 (U-5)', () => {
    const a = messages.append({ conversationId: convId, role: 'user', content: 'hi' })
    const b = messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
    })
    const c = messages.append({ conversationId: convId, role: 'user', content: 'again' })
    expect(a.position).toBe(0)
    expect(b.position).toBe(1)
    expect(c.position).toBe(2)
  })

  test('append with role: tool succeeds (Step 0.5 #1)', () => {
    messages.append({ conversationId: convId, role: 'user', content: 'q' })
    messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'tu1',
          toolName: 'drug_info',
          input: { query: 'ibuprofen' },
        },
      ],
    })
    const tool = messages.append({
      conversationId: convId,
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'tu1',
          toolName: 'drug_info',
          output: { type: 'json', value: { ok: true } },
        },
      ],
    })
    expect(tool.position).toBe(2)
    const history = messages.loadHistory(convId)
    expect(history[2]?.role).toBe('tool')
    const content = history[2]?.content as Array<{ type: string }>
    expect(content[0]?.type).toBe('tool-result')
  })

  test('append with invalid role rejects (CHECK constraint)', () => {
    expect(() =>
      messages.append({
        conversationId: convId,
        // @ts-expect-error — runtime CHECK guard
        role: 'system',
        content: 'x',
      }),
    ).toThrow()
  })

  test('appending duplicate (conversation_id, position) is impossible via repo', () => {
    // The UNIQUE constraint is the safety net; the repo guarantees no collision
    // by reading the current max(position) inside a transaction. We assert the
    // generated positions are strictly increasing.
    const ids = Array.from({ length: 5 }, (_, i) =>
      messages.append({ conversationId: convId, role: 'user', content: `msg${i}` }),
    )
    expect(ids.map((m) => m.position)).toEqual([0, 1, 2, 3, 4])
  })

  test('loadHistory returns rows ordered by position', () => {
    messages.append({ conversationId: convId, role: 'user', content: 'a' })
    messages.append({ conversationId: convId, role: 'assistant', content: [{ type: 'text', text: 'b' }] })
    messages.append({ conversationId: convId, role: 'user', content: 'c' })
    const h2 = messages.loadHistory(convId)
    expect(h2.map((m) => m.position)).toEqual([0, 1, 2])
    expect(h2.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  test('deleteAndRenumber renumbers later rows via two-pass shift (U-6, Step 0.5 #3)', () => {
    const a = messages.append({ conversationId: convId, role: 'user', content: 'a' })
    const b = messages.append({ conversationId: convId, role: 'assistant', content: [{ type: 'text', text: 'b' }] })
    const c = messages.append({ conversationId: convId, role: 'user', content: 'c' })
    const d = messages.append({ conversationId: convId, role: 'assistant', content: [{ type: 'text', text: 'd' }] })
    expect([a.position, b.position, c.position, d.position]).toEqual([0, 1, 2, 3])

    messages.deleteAndRenumber(b.id)

    const after = messages.loadHistory(convId)
    expect(after.map((m) => m.id)).toEqual([a.id, c.id, d.id])
    expect(after.map((m) => m.position)).toEqual([0, 1, 2])
  })

  test('deleteAndRenumber on the last row leaves remaining positions untouched', () => {
    const a = messages.append({ conversationId: convId, role: 'user', content: 'a' })
    const b = messages.append({ conversationId: convId, role: 'user', content: 'b' })
    messages.deleteAndRenumber(b.id)
    const after = messages.loadHistory(convId)
    expect(after.map((m) => m.id)).toEqual([a.id])
    expect(after[0]?.position).toBe(0)
  })

  test('deleteUserTurn cascades through the rest of the turn (Step 0.6 §3)', () => {
    // Build:
    //   pos 0 user "q1"
    //   pos 1 assistant tool-call
    //   pos 2 tool tool-result
    //   pos 3 assistant text
    //   pos 4 user "q2"
    //   pos 5 assistant text
    const u1 = messages.append({ conversationId: convId, role: 'user', content: 'q1' })
    messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'x', input: {} }],
    })
    messages.append({
      conversationId: convId,
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 't1',
          toolName: 'x',
          output: { type: 'json', value: {} },
        },
      ],
    })
    messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [{ type: 'text', text: 'a1' }],
    })
    const u2 = messages.append({ conversationId: convId, role: 'user', content: 'q2' })
    const a2 = messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [{ type: 'text', text: 'a2' }],
    })

    messages.deleteUserTurn(u1.id)

    const after = messages.loadHistory(convId)
    expect(after.map((m) => m.id)).toEqual([u2.id, a2.id])
    expect(after.map((m) => m.position)).toEqual([0, 1])
  })

  test('deleteUserTurn on non-user message id throws INVALID_TARGET', () => {
    messages.append({ conversationId: convId, role: 'user', content: 'q' })
    const a = messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [{ type: 'text', text: 'a' }],
    })
    let caught: unknown
    try {
      messages.deleteUserTurn(a.id)
    } catch (err) {
      caught = err
    }
    expect((caught as { code?: string }).code).toBe('INVALID_TARGET')
    expect((caught as { status?: number }).status).toBe(400)
  })

  test('deleteUserTurn on unknown id throws NOT_FOUND', () => {
    let caught: unknown
    try {
      messages.deleteUserTurn('01J0000000000000000000000Z')
    } catch (err) {
      caught = err
    }
    expect((caught as { code?: string }).code).toBe('NOT_FOUND')
    expect((caught as { status?: number }).status).toBe(404)
  })
})
