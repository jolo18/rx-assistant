import { describe, expect, test } from 'bun:test'
import {
  ALLOWED_SSE_EVENT_NAMES,
  createTranslateCtx,
  translate,
  type AnyStreamPart,
  type SSEEvent,
} from '../../src/agent/translate'

/**
 * C-1 — every name we emit on the wire must be in the spec §3.2.1 catalog.
 * Step 0.6 dropped the `done` event; this test guards against accidentally
 * adding it back (or any new event) without updating the spec.
 */
describe('SSE taxonomy contract (C-1)', () => {
  test('canonical catalog excludes "done" (Step 0.6)', () => {
    expect(ALLOWED_SSE_EVENT_NAMES).not.toContain('done')
  })

  test('canonical catalog matches spec §3.2.1 exactly', () => {
    expect([...ALLOWED_SSE_EVENT_NAMES].sort()).toEqual(
      [
        'start',
        'text-delta',
        'reasoning-start',
        'reasoning-delta',
        'reasoning-end',
        'tool-call-start',
        'tool-call-delta',
        'tool-call-end',
        'tool-call-result',
        'step',
        'metadata',
        'error',
      ].sort(),
    )
  })

  test('every translate output (across a representative fixture) is in the catalog', () => {
    const ctx = createTranslateCtx()
    const fixtureParts: AnyStreamPart[] = [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'hi' },
      { type: 'text-end', id: 't1' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', text: 'thinking' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'tool-input-start', id: 'tu1', toolName: 'drug_info' },
      { type: 'tool-input-delta', id: 'tu1', delta: '{}' },
      { type: 'tool-input-end', id: 'tu1' },
      { type: 'tool-call', toolCallId: 'tu1', toolName: 'drug_info', input: {} },
      {
        type: 'tool-result',
        toolCallId: 'tu1',
        toolName: 'drug_info',
        input: {},
        output: { ok: true },
      },
      { type: 'tool-error', toolCallId: 'tu2', toolName: 'drug_info', error: new Error('x') },
      { type: 'finish-step', finishReason: 'tool-calls', usage: {} },
      { type: 'finish-step', finishReason: 'stop', usage: {} },
      { type: 'finish', finishReason: 'stop', totalUsage: {} },
      { type: 'error', error: new Error('boom') },
      { type: 'abort', reason: 'client' },
    ]

    const emitted: string[] = []
    for (const p of fixtureParts) {
      const ev = translate(p, ctx) as SSEEvent | null
      if (ev) emitted.push(ev.event)
    }

    // Sanity: at least the obvious ones should have fired.
    expect(emitted).toContain('text-delta')
    expect(emitted).toContain('reasoning-delta')
    expect(emitted).toContain('tool-call-result')
    expect(emitted).toContain('step')
    expect(emitted).toContain('error')

    for (const name of emitted) {
      expect(ALLOWED_SSE_EVENT_NAMES).toContain(name)
    }
  })

  test('no fixture produces a "done" event (Step 0.6 — metadata is terminal)', () => {
    const ctx = createTranslateCtx()
    const fixtureParts: AnyStreamPart[] = [
      { type: 'text-delta', id: 't1', text: 'hi' },
      { type: 'finish-step', finishReason: 'stop', usage: {} },
      { type: 'finish', finishReason: 'stop', totalUsage: {} },
    ]
    const emitted = fixtureParts
      .map((p) => translate(p, ctx) as SSEEvent | null)
      .filter((ev): ev is SSEEvent => ev !== null)
      .map((ev) => ev.event)
    expect(emitted).not.toContain('done')
  })
})
