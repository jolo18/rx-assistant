import { describe, expect, test } from 'bun:test'
import { ChatRequestSchema, MAX_MESSAGE_LENGTH } from '../../src/lib/validate'

describe('ChatRequestSchema (U-2)', () => {
  test('accepts a valid request without conversationId', () => {
    const r = ChatRequestSchema.safeParse({ message: 'What is ibuprofen?' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.message).toBe('What is ibuprofen?')
      expect(r.data.conversationId).toBeUndefined()
    }
  })

  test('accepts a valid request with conversationId + model override', () => {
    const r = ChatRequestSchema.safeParse({
      message: 'hello',
      conversationId: '01J9XABCDEFGHJKMNPQRSTVWXY',
      model: 'openai/gpt-5',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.conversationId).toBe('01J9XABCDEFGHJKMNPQRSTVWXY')
      expect(r.data.model).toBe('openai/gpt-5')
    }
  })

  test('rejects missing message', () => {
    const r = ChatRequestSchema.safeParse({})
    expect(r.success).toBe(false)
  })

  test('rejects empty message', () => {
    const r = ChatRequestSchema.safeParse({ message: '' })
    expect(r.success).toBe(false)
  })

  test('rejects whitespace-only message', () => {
    const r = ChatRequestSchema.safeParse({ message: '   \n\t  ' })
    expect(r.success).toBe(false)
  })

  test('rejects message longer than MAX_MESSAGE_LENGTH (Step 0.6 I-4c)', () => {
    const r = ChatRequestSchema.safeParse({
      message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1),
    })
    expect(r.success).toBe(false)
  })

  test('accepts message at exactly MAX_MESSAGE_LENGTH', () => {
    const r = ChatRequestSchema.safeParse({ message: 'x'.repeat(MAX_MESSAGE_LENGTH) })
    expect(r.success).toBe(true)
  })

  test('rejects null conversationId (Step 0.6 §4 — undefined only)', () => {
    const r = ChatRequestSchema.safeParse({ message: 'hi', conversationId: null })
    expect(r.success).toBe(false)
  })

  test('rejects non-string message types', () => {
    expect(ChatRequestSchema.safeParse({ message: 42 }).success).toBe(false)
    expect(ChatRequestSchema.safeParse({ message: ['x'] }).success).toBe(false)
    expect(ChatRequestSchema.safeParse({ message: {} }).success).toBe(false)
  })
})
