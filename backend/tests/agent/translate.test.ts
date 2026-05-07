import { describe, expect, test } from 'bun:test'
import {
  createTranslateCtx,
  translate,
  type AnyStreamPart,
  type SSEEvent,
} from '../../src/agent/translate'

function ctx() {
  return createTranslateCtx()
}

describe('translate — text parts', () => {
  test('text-start → null (server tracks state, no wire event)', () => {
    expect(translate({ type: 'text-start', id: 't1' } as AnyStreamPart, ctx())).toBeNull()
  })

  test('text-delta → { event: "text-delta", data: { delta } } (uses part.text)', () => {
    const ev = translate(
      { type: 'text-delta', id: 't1', text: 'Ibu' } as AnyStreamPart,
      ctx(),
    )
    expect(ev).toEqual({ event: 'text-delta', data: { delta: 'Ibu' } })
  })

  test('text-end → null', () => {
    expect(translate({ type: 'text-end', id: 't1' } as AnyStreamPart, ctx())).toBeNull()
  })
})

describe('translate — reasoning parts', () => {
  test('reasoning-start → reasoning-start with empty data', () => {
    expect(
      translate({ type: 'reasoning-start', id: 'r1' } as AnyStreamPart, ctx()),
    ).toEqual({ event: 'reasoning-start', data: {} })
  })

  test('reasoning-delta uses part.text', () => {
    const ev = translate(
      { type: 'reasoning-delta', id: 'r1', text: 'I should ' } as AnyStreamPart,
      ctx(),
    )
    expect(ev).toEqual({ event: 'reasoning-delta', data: { delta: 'I should ' } })
  })

  test('reasoning-end → reasoning-end with empty data', () => {
    expect(
      translate({ type: 'reasoning-end', id: 'r1' } as AnyStreamPart, ctx()),
    ).toEqual({ event: 'reasoning-end', data: {} })
  })
})

describe('translate — tool input/call parts', () => {
  test('tool-input-start → tool-call-start with id + name', () => {
    expect(
      translate(
        { type: 'tool-input-start', id: 'tu1', toolName: 'drug_info' } as AnyStreamPart,
        ctx(),
      ),
    ).toEqual({ event: 'tool-call-start', data: { id: 'tu1', name: 'drug_info' } })
  })

  test('tool-input-delta → tool-call-delta with partialInput (uses part.delta)', () => {
    expect(
      translate(
        { type: 'tool-input-delta', id: 'tu1', delta: '{"qu' } as AnyStreamPart,
        ctx(),
      ),
    ).toEqual({ event: 'tool-call-delta', data: { id: 'tu1', partialInput: '{"qu' } })
  })

  test('tool-input-end → null (defer to tool-call which has parsed input)', () => {
    expect(
      translate({ type: 'tool-input-end', id: 'tu1' } as AnyStreamPart, ctx()),
    ).toBeNull()
  })

  test('tool-call → tool-call-end with parsed input', () => {
    const ev = translate(
      {
        type: 'tool-call',
        toolCallId: 'tu1',
        toolName: 'drug_info',
        input: { query: 'ibuprofen' },
      } as AnyStreamPart,
      ctx(),
    )
    expect(ev).toEqual({
      event: 'tool-call-end',
      data: { id: 'tu1', input: { query: 'ibuprofen' } },
    })
  })
})

describe('translate — tool result / error parts', () => {
  test('tool-result with healthy output → isError:false + durationMs', () => {
    const c = ctx()
    // Start tracking duration on tool-input-start.
    translate(
      { type: 'tool-input-start', id: 'tu1', toolName: 'drug_info' } as AnyStreamPart,
      c,
    )
    const ev = translate(
      {
        type: 'tool-result',
        toolCallId: 'tu1',
        toolName: 'drug_info',
        input: { query: 'x' },
        output: { name: 'Advil', indications: 'pain' },
      } as AnyStreamPart,
      c,
    ) as SSEEvent
    expect(ev.event).toBe('tool-call-result')
    const data = ev.data as {
      id: string
      output: unknown
      isError: boolean
      durationMs: number
    }
    expect(data.id).toBe('tu1')
    expect(data.isError).toBe(false)
    expect(data.output).toEqual({ name: 'Advil', indications: 'pain' })
    expect(typeof data.durationMs).toBe('number')
    expect(data.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('tool-result whose output is { error: { ... } } → isError: true', () => {
    const c = ctx()
    translate(
      { type: 'tool-input-start', id: 'tu2', toolName: 'drug_info' } as AnyStreamPart,
      c,
    )
    const ev = translate(
      {
        type: 'tool-result',
        toolCallId: 'tu2',
        toolName: 'drug_info',
        input: { query: 'x' },
        output: { error: { code: 'DRUG_NOT_FOUND', message: 'not found' } },
      } as AnyStreamPart,
      c,
    ) as SSEEvent
    expect((ev.data as { isError: boolean }).isError).toBe(true)
  })

  test('tool-error → tool-call-result with isError:true (F-3 surface)', () => {
    const c = ctx()
    translate(
      { type: 'tool-input-start', id: 'tu3', toolName: 'drug_info' } as AnyStreamPart,
      c,
    )
    const ev = translate(
      {
        type: 'tool-error',
        toolCallId: 'tu3',
        toolName: 'drug_info',
        input: { query: 'x' },
        error: new Error('openFDA 503'),
      } as AnyStreamPart,
      c,
    ) as SSEEvent
    expect(ev.event).toBe('tool-call-result')
    const data = ev.data as { id: string; isError: boolean; output: { message: string } }
    expect(data.id).toBe('tu3')
    expect(data.isError).toBe(true)
    expect(data.output.message).toBe('openFDA 503')
  })
})

describe('translate — finishReason → step / error mapping (Step 0.6)', () => {
  test('finish-step finishReason: "stop" → step{reason:"final"}', () => {
    const c = ctx()
    const ev = translate(
      {
        type: 'finish-step',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      } as AnyStreamPart,
      c,
    )
    expect(ev).toEqual({ event: 'step', data: { index: 1, reason: 'final' } })
  })

  test('finish-step finishReason: "tool-calls" → step{reason:"tool"}', () => {
    const c = ctx()
    const ev = translate(
      { type: 'finish-step', finishReason: 'tool-calls', usage: {} } as AnyStreamPart,
      c,
    )
    expect(ev).toEqual({ event: 'step', data: { index: 1, reason: 'tool' } })
  })

  test('step index increments across multiple finish-step parts', () => {
    const c = ctx()
    const a = translate(
      { type: 'finish-step', finishReason: 'tool-calls', usage: {} } as AnyStreamPart,
      c,
    ) as SSEEvent
    const b = translate(
      { type: 'finish-step', finishReason: 'stop', usage: {} } as AnyStreamPart,
      c,
    ) as SSEEvent
    expect((a.data as { index: number }).index).toBe(1)
    expect((b.data as { index: number }).index).toBe(2)
  })

  test('finish-step "length" → error{code:"UPSTREAM_TRUNCATED"} (Step 0.6)', () => {
    const c = ctx()
    const ev = translate(
      { type: 'finish-step', finishReason: 'length', usage: {} } as AnyStreamPart,
      c,
    ) as SSEEvent
    expect(ev.event).toBe('error')
    expect((ev.data as { code: string }).code).toBe('UPSTREAM_TRUNCATED')
  })

  test('finish-step "content-filter" → error{code:"CONTENT_FILTERED"} (Step 0.6)', () => {
    const c = ctx()
    const ev = translate(
      {
        type: 'finish-step',
        finishReason: 'content-filter',
        usage: {},
      } as AnyStreamPart,
      c,
    ) as SSEEvent
    expect(ev.event).toBe('error')
    expect((ev.data as { code: string }).code).toBe('CONTENT_FILTERED')
  })

  test('finish-step "error" / "other" / "unknown" → error{code:"UPSTREAM_ERROR"}', () => {
    for (const reason of ['error', 'other', 'unknown'] as const) {
      const c = ctx()
      const ev = translate(
        { type: 'finish-step', finishReason: reason, usage: {} } as AnyStreamPart,
        c,
      ) as SSEEvent
      expect(ev.event).toBe('error')
      expect((ev.data as { code: string }).code).toBe('UPSTREAM_ERROR')
    }
  })
})

describe('translate — terminal parts', () => {
  test('finish (top-level) → null (caller emits metadata after computing latency + cost)', () => {
    expect(
      translate(
        {
          type: 'finish',
          finishReason: 'stop',
          totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        } as AnyStreamPart,
        ctx(),
      ),
    ).toBeNull()
  })

  test('error (top-level) → error{code:"UPSTREAM_ERROR"} carrying err.message', () => {
    const ev = translate(
      { type: 'error', error: new Error('boom') } as AnyStreamPart,
      ctx(),
    ) as SSEEvent
    expect(ev.event).toBe('error')
    expect((ev.data as { code: string }).code).toBe('UPSTREAM_ERROR')
    expect((ev.data as { message: string }).message).toBe('boom')
  })

  test('abort → error{code:"UPSTREAM_TIMEOUT"}', () => {
    const ev = translate(
      { type: 'abort', reason: 'client closed' } as AnyStreamPart,
      ctx(),
    ) as SSEEvent
    expect(ev.event).toBe('error')
    expect((ev.data as { code: string }).code).toBe('UPSTREAM_TIMEOUT')
  })

  test('start (top-level) → null (server emits its own start frame)', () => {
    expect(translate({ type: 'start' } as AnyStreamPart, ctx())).toBeNull()
  })

  test('start-step → null', () => {
    expect(
      translate(
        { type: 'start-step', request: {}, warnings: [] } as AnyStreamPart,
        ctx(),
      ),
    ).toBeNull()
  })

  test('unrecognized parts (source / file / raw / tool-output-denied) → null', () => {
    for (const type of ['source', 'file', 'raw', 'tool-output-denied'] as const) {
      expect(translate({ type } as AnyStreamPart, ctx())).toBeNull()
    }
  })
})
