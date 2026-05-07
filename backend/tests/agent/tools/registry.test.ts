import { describe, expect, test } from 'bun:test'
import { createTools } from '../../../src/agent/tools'

describe('tools registry', () => {
  test('createTools returns drug_info + symptom_lookup, both with AI SDK tool shape', () => {
    const tools = createTools({ TOOL_TIMEOUT_MS: 5000 })
    expect(Object.keys(tools).sort()).toEqual(['drug_info', 'symptom_lookup'])
    for (const t of Object.values(tools)) {
      expect(typeof t.description).toBe('string')
      expect((t.description ?? '').length).toBeGreaterThan(10)
      expect(t.inputSchema).toBeDefined()
      expect(typeof t.execute).toBe('function')
    }
  })
})
