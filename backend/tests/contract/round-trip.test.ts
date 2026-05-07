import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ModelMessage } from 'ai'
import { openDb, type DbHandle } from '../../src/db/client'
import { makeConversationsRepo } from '../../src/db/repos/conversations'
import { makeMessagesRepo } from '../../src/db/repos/messages'
import { storedToModelMessages } from '../../src/agent/translate'

/**
 * C-3 — a conversation persisted via the repos must round-trip back into
 * AI SDK `ModelMessage[]` shape without provider-side validation errors.
 *
 * In Slice 5 we only assert the structural conversion. Slice 6 will exercise
 * the full path through `streamText({ messages, model: mockModel })`.
 */
describe('persistence ↔ ModelMessage round-trip (C-3)', () => {
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

  test('user-only conversation rebuilds as Array<UserModelMessage>', () => {
    messages.append({
      conversationId: convId,
      role: 'user',
      content: 'What is ibuprofen?',
    })
    const stored = messages.loadHistory(convId)
    const model = storedToModelMessages(stored)
    expect(model).toHaveLength(1)
    expect(model[0]?.role).toBe('user')
    expect(model[0]?.content).toBe('What is ibuprofen?')
  })

  test('multi-step turn (user → assistant tool-call → tool tool-result → assistant text) round-trips', () => {
    messages.append({
      conversationId: convId,
      role: 'user',
      content: 'What is ibuprofen?',
    })
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
    messages.append({
      conversationId: convId,
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'tu1',
          toolName: 'drug_info',
          output: { type: 'json', value: { name: 'Advil' } },
        },
      ],
    })
    messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [{ type: 'text', text: 'Ibuprofen treats pain.' }],
    })

    const stored = messages.loadHistory(convId)
    const model = storedToModelMessages(stored)
    expect(model.map((m: ModelMessage) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ])

    // Assistant tool-call row
    const aTool = model[1]
    expect(aTool?.role).toBe('assistant')
    expect(Array.isArray(aTool?.content)).toBe(true)
    const aPart = (aTool?.content as Array<{ type: string; toolCallId?: string }>)[0]
    expect(aPart?.type).toBe('tool-call')
    expect(aPart?.toolCallId).toBe('tu1')

    // Tool row
    const t = model[2]
    expect(t?.role).toBe('tool')
    const tPart = (t?.content as Array<{ type: string; output: { type: string } }>)[0]
    expect(tPart?.type).toBe('tool-result')
    expect(tPart?.output.type).toBe('json')

    // Final assistant text row
    const aText = model[3]
    expect(aText?.role).toBe('assistant')
    const aTextPart = (aText?.content as Array<{ type: string; text: string }>)[0]
    expect(aTextPart?.type).toBe('text')
    expect(aTextPart?.text).toBe('Ibuprofen treats pain.')
  })

  test('reasoning parts on assistant rows survive the round-trip', () => {
    messages.append({ conversationId: convId, role: 'user', content: 'q' })
    messages.append({
      conversationId: convId,
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'I should mention NSAIDs.' },
        { type: 'text', text: 'Ibuprofen is an NSAID.' },
      ],
    })
    const stored = messages.loadHistory(convId)
    const model = storedToModelMessages(stored)
    const aPart = model[1]
    expect(aPart?.role).toBe('assistant')
    const parts = aPart?.content as Array<{ type: string; text?: string }>
    expect(parts.map((p) => p.type)).toEqual(['reasoning', 'text'])
  })
})
