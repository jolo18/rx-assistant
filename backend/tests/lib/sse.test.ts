import { describe, expect, test } from 'bun:test'
import { encode } from '../../src/lib/sse'

describe('sse.encode (U-7)', () => {
  test('emits event: + data: + double-newline terminator', () => {
    const out = encode({ event: 'text-delta', data: { delta: 'hi' } })
    expect(out).toBe('event: text-delta\ndata: {"delta":"hi"}\n\n')
  })

  test('serializes empty data as {}', () => {
    const out = encode({ event: 'reasoning-start', data: {} })
    expect(out).toBe('event: reasoning-start\ndata: {}\n\n')
  })

  test('preserves nested objects and special chars in JSON', () => {
    const out = encode({
      event: 'tool-call-end',
      data: { id: 'tu_1', input: { query: 'line1\nline2' } },
    })
    // Newlines inside the JSON-string value are escaped to \n by JSON.stringify,
    // so the SSE frame stays single-data-line.
    expect(out).toBe(
      'event: tool-call-end\ndata: {"id":"tu_1","input":{"query":"line1\\nline2"}}\n\n',
    )
    // And the on-the-wire frame contains exactly one '\n\n' terminator.
    expect(out.split('\n\n')).toHaveLength(2)
  })

  test('event name with hyphens is preserved verbatim', () => {
    const out = encode({ event: 'tool-call-result', data: { id: 'x', output: null } })
    expect(out.startsWith('event: tool-call-result\n')).toBe(true)
  })

  test('rejects event names containing newlines or colons (defensive)', () => {
    expect(() => encode({ event: 'bad\nname', data: {} })).toThrow()
    expect(() => encode({ event: 'bad: name', data: {} })).toThrow()
  })
})
