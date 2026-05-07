import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV3 } from 'ai/test'
import { buildApp, stubTool, type TestApp } from '../_helpers/buildApp'
import { collectSSE, eventNames } from '../_helpers/collectSSE'
import { scriptModel, usageOf } from '../_helpers/scriptModel'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

function postChat(app: TestApp['app'], body: unknown, init?: RequestInit) {
  return app.request('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  })
}

describe('POST /api/chat — Slice 6', () => {
  let h: TestApp | null = null
  afterEach(() => {
    h?.close()
    h = null
  })

  // ────────────────────────────────────────────────────────────────────
  // I-1 — Happy path: text-only response
  // ────────────────────────────────────────────────────────────────────
  test('I-1 — happy path text response, persists user + assistant + usage', async () => {
    const { model, callCounter } = scriptModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Ibu' },
      { type: 'text-delta', id: 't1', delta: 'profen' },
      { type: 'text-delta', id: 't1', delta: ' is an NSAID.' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: usageOf({ inputTokens: 12, outputTokens: 8 }),
      },
    ])

    h = buildApp({ model })
    const res = await postChat(h.app, { message: 'What is ibuprofen?' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    const frames = await collectSSE(res)
    const names = eventNames(frames)
    expect(names[0]).toBe('start')
    expect(names).toContain('text-delta')
    expect(names[names.length - 1]).toBe('metadata')
    expect(names).not.toContain('done')
    expect(names).not.toContain('error')

    const start = frames[0]!.data as {
      messageId: string
      userMessageId: string
      conversationId: string
      model: string
    }
    expect(start.messageId).toMatch(ULID_RE)
    expect(start.userMessageId).toMatch(ULID_RE)
    expect(start.conversationId).toMatch(ULID_RE)
    expect(start.model).toBe('anthropic/claude-sonnet-4.6')

    const deltas = frames
      .filter((f) => f.event === 'text-delta')
      .map((f) => (f.data as { delta: string }).delta)
    expect(deltas.join('')).toBe('Ibuprofen is an NSAID.')

    const metadata = frames[frames.length - 1]!.data as {
      messageId: string
      model: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreateTokens: number
      latencyMs: number
      costUsd: number
    }
    expect(metadata.inputTokens).toBe(12)
    expect(metadata.outputTokens).toBe(8)
    expect(metadata.cacheReadTokens).toBe(0)
    expect(metadata.cacheCreateTokens).toBe(0)
    expect(metadata.latencyMs).toBeGreaterThanOrEqual(0)
    expect(metadata.costUsd).toBeGreaterThan(0)

    // DB asserts
    const convs = h.db.sqlite.query<{ id: string }, []>('SELECT id FROM conversations').all()
    expect(convs).toHaveLength(1)
    const msgs = h.db.sqlite
      .query<{ role: string; content: string; position: number }, []>(
        'SELECT role, content, position FROM messages ORDER BY position',
      )
      .all()
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.role).toBe('user')
    expect(msgs[1]!.role).toBe('assistant')
    const usages = h.db.sqlite
      .query<{ input_tokens: number; output_tokens: number }, []>(
        'SELECT input_tokens, output_tokens FROM usage',
      )
      .all()
    expect(usages).toHaveLength(1)
    expect(usages[0]!.input_tokens).toBe(12)
    expect(usages[0]!.output_tokens).toBe(8)

    // Mock counter
    expect(callCounter.count).toBe(1)
  })

  // ────────────────────────────────────────────────────────────────────
  // I-1r — Reasoning streamed before text
  // ────────────────────────────────────────────────────────────────────
  test('I-1r — reasoning streams before text, content preserved on reload', async () => {
    const { model } = scriptModel([
      { type: 'stream-start', warnings: [] },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'I should ' },
      { type: 'reasoning-delta', id: 'r1', delta: 'mention NSAID.' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Ibuprofen is an NSAID.' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: usageOf({ inputTokens: 10, outputTokens: 6 }),
      },
    ])
    h = buildApp({ model })
    const frames = await collectSSE(await postChat(h.app, { message: 'q' }))
    const names = eventNames(frames)
    const reasoningIdx = names.indexOf('reasoning-delta')
    const textIdx = names.indexOf('text-delta')
    expect(reasoningIdx).toBeGreaterThan(-1)
    expect(textIdx).toBeGreaterThan(-1)
    expect(reasoningIdx).toBeLessThan(textIdx)

    const reasoningDeltas = frames
      .filter((f) => f.event === 'reasoning-delta')
      .map((f) => (f.data as { delta: string }).delta)
    expect(reasoningDeltas.join('')).toBe('I should mention NSAID.')

    // Persisted assistant content should contain the reasoning part for replay.
    const assistant = h.db.sqlite
      .query<{ content: string }, []>(
        "SELECT content FROM messages WHERE role = 'assistant' ORDER BY position LIMIT 1",
      )
      .get()
    const parts = JSON.parse(assistant!.content) as Array<{ type: string; text?: string }>
    const types = parts.map((p) => p.type)
    expect(types).toContain('reasoning')
    expect(types).toContain('text')
  })

  // ────────────────────────────────────────────────────────────────────
  // I-2 — Single tool call, full roundtrip (4 persisted rows)
  // ────────────────────────────────────────────────────────────────────
  test('I-2 — tool roundtrip: 4 rows, one usage, summed tokens', async () => {
    const { model, callCounter } = scriptModel(
      // Call 1: model requests a tool call.
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-input-start', id: 'tu1', toolName: 'drug_info' },
        { type: 'tool-input-delta', id: 'tu1', delta: '{"qu' },
        { type: 'tool-input-delta', id: 'tu1', delta: 'ery":"ibuprofen"}' },
        { type: 'tool-input-end', id: 'tu1' },
        {
          type: 'tool-call',
          toolCallId: 'tu1',
          toolName: 'drug_info',
          input: '{"query":"ibuprofen"}',
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: usageOf({ inputTokens: 50, outputTokens: 20 }),
        },
      ],
      // Call 2: after tool result, model produces final text.
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Ibuprofen treats pain.' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: usageOf({ inputTokens: 80, outputTokens: 10 }),
        },
      ],
    )
    const drug_info = stubTool({
      output: {
        name: 'Advil',
        indications: 'pain',
        warnings: 'kidneys',
        dosage: '200-400mg',
      },
    })
    h = buildApp({ model, tools: { drug_info } })
    const frames = await collectSSE(await postChat(h.app, { message: 'What is ibuprofen?' }))
    const names = eventNames(frames)

    // Wire shape
    expect(names).toContain('tool-call-start')
    expect(names).toContain('tool-call-delta')
    expect(names).toContain('tool-call-end')
    expect(names).toContain('tool-call-result')
    expect(names).toContain('text-delta')
    expect(names[names.length - 1]).toBe('metadata')
    expect(names).not.toContain('error')

    // Tool call payloads
    const tcs = frames.find((f) => f.event === 'tool-call-start')!.data as {
      id: string
      name: string
    }
    expect(tcs.id).toBe('tu1')
    expect(tcs.name).toBe('drug_info')

    const tcEnd = frames.find((f) => f.event === 'tool-call-end')!.data as {
      id: string
      input: { query: string }
    }
    expect(tcEnd.input).toEqual({ query: 'ibuprofen' })

    const tcr = frames.find((f) => f.event === 'tool-call-result')!.data as {
      id: string
      isError: boolean
      output: unknown
    }
    expect(tcr.id).toBe('tu1')
    expect(tcr.isError).toBe(false)

    // Mock counter — two model invocations
    expect(callCounter.count).toBe(2)
    expect(drug_info.callCount()).toBe(1)
    expect(drug_info.lastInput()).toEqual({ query: 'ibuprofen' })

    // DB: 4 rows (user, assistant tool-call, tool tool-result, assistant text)
    const rows = h.db.sqlite
      .query<{ role: string; content: string; position: number; id: string }, []>(
        'SELECT id, role, content, position FROM messages ORDER BY position',
      )
      .all()
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])

    // Usage: exactly one row, summed
    const usageRows = h.db.sqlite
      .query<{ input_tokens: number; output_tokens: number; message_id: string }, []>(
        'SELECT input_tokens, output_tokens, message_id FROM usage',
      )
      .all()
    expect(usageRows).toHaveLength(1)
    expect(usageRows[0]!.input_tokens).toBe(130)
    expect(usageRows[0]!.output_tokens).toBe(30)
    // Usage must link to the LAST assistant message (Step 0.5 #4).
    expect(usageRows[0]!.message_id).toBe(rows[3]!.id)
  })

  // ────────────────────────────────────────────────────────────────────
  // I-2e — Tool execution error → loop continues
  // ────────────────────────────────────────────────────────────────────
  test('I-2e — tool error surfaces isError:true and loop continues', async () => {
    const { model } = scriptModel(
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-input-start', id: 'tu1', toolName: 'drug_info' },
        { type: 'tool-input-end', id: 'tu1' },
        {
          type: 'tool-call',
          toolCallId: 'tu1',
          toolName: 'drug_info',
          input: '{"query":"x"}',
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: usageOf({ inputTokens: 5, outputTokens: 5 }),
        },
      ],
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Sorry, something went wrong.' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: usageOf({ inputTokens: 10, outputTokens: 5 }),
        },
      ],
    )
    const drug_info = stubTool({ throws: new Error('openFDA 503') })
    h = buildApp({ model, tools: { drug_info } })
    const frames = await collectSSE(await postChat(h.app, { message: 'q' }))

    const tcr = frames.find((f) => f.event === 'tool-call-result')!.data as {
      isError: boolean
      output: unknown
    }
    expect(tcr.isError).toBe(true)

    expect(eventNames(frames)).toContain('text-delta')
    expect(eventNames(frames)).not.toContain('error')

    // Health endpoint still up
    const healthRes = await h.app.request('/health')
    expect(healthRes.status).toBe(200)
  })

  // ────────────────────────────────────────────────────────────────────
  // I-3 — Step cap reached
  // ────────────────────────────────────────────────────────────────────
  test('I-3 — step cap fires step{capped} and persists no orphan tool_use', async () => {
    let toolCounter = 0
    const toolCallScript = (): LanguageModelV3StreamPart[] => {
      toolCounter += 1
      return [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-input-start', id: `tu${toolCounter}`, toolName: 'drug_info' },
        { type: 'tool-input-end', id: `tu${toolCounter}` },
        {
          type: 'tool-call',
          toolCallId: `tu${toolCounter}`,
          toolName: 'drug_info',
          input: '{"query":"x"}',
        },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: usageOf({ inputTokens: 30, outputTokens: 10 }),
        },
      ]
    }
    // We need *fresh* tool ids per call so AI SDK doesn't dedupe — use a custom
    // mock that calls toolCallScript() per invocation.
    const callCounter = { count: 0 }
    const model = new MockLanguageModelV3({
      modelId: 'mock-model',
      provider: 'mock',
      doStream: async (_opts: LanguageModelV3CallOptions) => {
        callCounter.count += 1
        const parts = toolCallScript()
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          start(c) {
            for (const p of parts) c.enqueue(p)
            c.close()
          },
        })
        return { stream }
      },
    })

    const drug_info = stubTool({ output: { ok: true } })
    h = buildApp({ model, tools: { drug_info }, env: { MAX_AGENT_STEPS: 2 } })
    const frames = await collectSSE(await postChat(h.app, { message: 'q' }))
    const names = eventNames(frames)

    expect(names).not.toContain('error')
    expect(names).toContain('step')
    expect(names[names.length - 1]).toBe('metadata')

    // Mock invoked exactly twice (cap honored)
    expect(callCounter.count).toBe(2)

    // DB: every tool-call has a matching tool-result (NFR-8)
    const rows = h.db.sqlite
      .query<{ role: string; content: string }, []>(
        'SELECT role, content FROM messages ORDER BY position',
      )
      .all()
    const toolCallIds = new Set<string>()
    const toolResultIds = new Set<string>()
    for (const r of rows) {
      if (r.role !== 'assistant' && r.role !== 'tool') continue
      const parts = JSON.parse(r.content) as Array<{ type: string; toolCallId?: string }>
      for (const p of parts) {
        if (p.type === 'tool-call' && p.toolCallId) toolCallIds.add(p.toolCallId)
        if (p.type === 'tool-result' && p.toolCallId) toolResultIds.add(p.toolCallId)
      }
    }
    for (const id of toolCallIds) {
      expect(toolResultIds.has(id)).toBe(true)
    }
  })

  // ────────────────────────────────────────────────────────────────────
  // I-4 — Invalid body
  // ────────────────────────────────────────────────────────────────────
  test('I-4a — empty body → 400 INVALID_INPUT, no DB writes, no model call', async () => {
    const { model, callCounter } = scriptModel([])
    h = buildApp({ model })
    const before = h.db.sqlite
      .query<{ n: number }, []>(
        'SELECT (SELECT COUNT(*) FROM conversations) + (SELECT COUNT(*) FROM messages) + (SELECT COUNT(*) FROM usage) AS n',
      )
      .get()!.n

    const res = await postChat(h.app, {})
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_INPUT')

    const after = h.db.sqlite
      .query<{ n: number }, []>(
        'SELECT (SELECT COUNT(*) FROM conversations) + (SELECT COUNT(*) FROM messages) + (SELECT COUNT(*) FROM usage) AS n',
      )
      .get()!.n
    expect(after).toBe(before)
    expect(callCounter.count).toBe(0)
  })

  test('I-4b — empty message → 400 INVALID_INPUT', async () => {
    const { model } = scriptModel([])
    h = buildApp({ model })
    const res = await postChat(h.app, { message: '' })
    expect(res.status).toBe(400)
  })

  test('I-4c — oversize message → 400 INVALID_INPUT', async () => {
    const { model } = scriptModel([])
    h = buildApp({ model })
    const res = await postChat(h.app, { message: 'x'.repeat(50_001) })
    expect(res.status).toBe(400)
  })

  // ────────────────────────────────────────────────────────────────────
  // I-8 — Provider timeout
  // ────────────────────────────────────────────────────────────────────
  test('I-8 — provider timeout → error{UPSTREAM_TIMEOUT}, partial assistant persisted', async () => {
    const model = new MockLanguageModelV3({
      modelId: 'mock-model',
      provider: 'mock',
      doStream: async ({ abortSignal }: LanguageModelV3CallOptions) => {
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          async pull(_controller) {
            await new Promise<void>((_, reject) => {
              abortSignal?.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              )
            })
          },
        })
        return { stream }
      },
    })
    h = buildApp({ model, env: { AI_TIMEOUT_MS: 50 } })
    const t0 = performance.now()
    const frames = await collectSSE(await postChat(h.app, { message: 'q' }))
    const elapsed = performance.now() - t0

    expect(elapsed).toBeLessThan(1500)
    const names = eventNames(frames)
    expect(names[0]).toBe('start')
    const err = frames.find((f) => f.event === 'error')!.data as {
      code: string
      message: string
    }
    expect(err.code).toBe('UPSTREAM_TIMEOUT')
    expect(names).not.toContain('metadata')

    // F-12: user message persisted, assistant row persisted with empty content.
    const rows = h.db.sqlite
      .query<{ role: string; content: string }, []>(
        'SELECT role, content FROM messages ORDER BY position',
      )
      .all()
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant'])
    expect(JSON.parse(rows[1]!.content)).toEqual([])

    const healthRes = await h.app.request('/health')
    expect(healthRes.status).toBe(200)
  })

  // ────────────────────────────────────────────────────────────────────
  // I-9 — Provider error mid-stream
  // ────────────────────────────────────────────────────────────────────
  test('I-9 — provider error mid-stream → error event, no orphan tool_use', async () => {
    const { model } = scriptModel([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-input-start', id: 'tu1', toolName: 'drug_info' },
      { type: 'tool-input-delta', id: 'tu1', delta: '{"que' },
      { type: 'error', error: new Error('provider blew up') },
    ])
    const drug_info = stubTool({ output: { ok: true } })
    h = buildApp({ model, tools: { drug_info } })
    const frames = await collectSSE(await postChat(h.app, { message: 'q' }))
    const names = eventNames(frames)
    expect(names[0]).toBe('start')
    expect(names).toContain('tool-call-start')
    expect(names).toContain('error')
    expect(names).not.toContain('metadata')

    // Tool was never executed (no tool-call part finalized)
    expect(drug_info.callCount()).toBe(0)

    // F-12: user persisted, assistant with content: []. No orphan tool_use.
    const rows = h.db.sqlite
      .query<{ role: string; content: string }, []>(
        'SELECT role, content FROM messages ORDER BY position',
      )
      .all()
    expect(rows[0]!.role).toBe('user')
    const allParts: string[] = []
    for (const r of rows) {
      if (r.role === 'user') continue
      const parts = JSON.parse(r.content) as Array<{ type: string }>
      for (const p of parts) allParts.push(p.type)
    }
    expect(allParts).not.toContain('tool-call')
  })

  // ────────────────────────────────────────────────────────────────────
  // I-10 — Concurrency (NFR-7)
  // ────────────────────────────────────────────────────────────────────
  test('I-10 — 10 concurrent streams complete cleanly under WAL', async () => {
    const N = 10
    const apps: TestApp[] = []
    for (let i = 0; i < N; i++) {
      const { model } = scriptModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'ok' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: usageOf({ inputTokens: 5, outputTokens: 1 }),
        },
      ])
      apps.push(buildApp({ model }))
    }
    try {
      const results = await Promise.all(
        apps.map((a, i) => postChat(a.app, { message: `hello-${i}` })),
      )
      expect(results.every((r) => r.status === 200)).toBe(true)
      const allFrames = await Promise.all(results.map(collectSSE))
      for (const fs of allFrames) {
        expect(fs[fs.length - 1]?.event).toBe('metadata')
        expect(eventNames(fs)).not.toContain('error')
      }
      for (const a of apps) {
        const cnt = a.db.sqlite
          .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM messages')
          .get()!.n
        expect(cnt).toBe(2) // user + assistant
      }
    } finally {
      for (const a of apps) a.close()
    }
  })

  // ────────────────────────────────────────────────────────────────────
  // I-11 — Client disconnect aborts upstream
  // ────────────────────────────────────────────────────────────────────
  test('I-11 — client AbortController.abort() propagates to upstream signal', async () => {
    const upstream: { aborted: boolean } = { aborted: false }
    const model = new MockLanguageModelV3({
      modelId: 'mock-model',
      provider: 'mock',
      doStream: async ({ abortSignal }: LanguageModelV3CallOptions) => {
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          async pull(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 't1' })
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'partial' })
            // Wait for abort then close — never finishes on its own.
            await new Promise<void>((resolve) => {
              abortSignal?.addEventListener('abort', () => {
                upstream.aborted = true
                resolve()
              })
            })
            controller.close()
          },
        })
        return { stream }
      },
    })
    h = buildApp({ model })

    const ctrl = new AbortController()
    const responsePromise = postChat(h.app, { message: 'q' }, { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 60)

    let caughtAbort = false
    try {
      const res = await responsePromise
      // Some runtimes propagate via the response body reader instead.
      try {
        await collectSSE(res)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') caughtAbort = true
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') caughtAbort = true
    }

    // At minimum: the upstream signal saw the abort.
    expect(upstream.aborted || caughtAbort).toBe(true)
  })
})
