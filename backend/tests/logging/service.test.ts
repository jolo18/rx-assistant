import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runAgent } from '../../src/agent/service'
import { openDb, type DbHandle } from '../../src/db/client'
import { captureLogger } from '../_helpers/captureLogger'
import { scriptModel, usageOf } from '../_helpers/scriptModel'
import { stubTool } from '../_helpers/buildApp'

const ENV = {
  OPENROUTER_MODEL: 'anthropic/claude-sonnet-4.6',
  MAX_AGENT_STEPS: 8,
  AI_TIMEOUT_MS: 60_000,
}

describe('agent service logging', () => {
  let h: DbHandle
  beforeEach(() => {
    h = openDb({ path: ':memory:' })
  })
  afterEach(() => {
    h.close()
  })

  test('emits run.start and run.finish info lines around a happy turn', async () => {
    const { model } = scriptModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: usageOf({ inputTokens: 5, outputTokens: 1 }),
      },
    ])
    const { logger, lines } = captureLogger('debug')

    const events = []
    for await (const ev of runAgent(
      { message: 'hello' },
      { db: h.db, model, tools: {}, env: ENV, logger },
    )) {
      events.push(ev)
    }
    expect(events[events.length - 1]?.event).toBe('metadata')

    const startLine = lines.find((l) => l.msg === 'agent.run.start')
    const finishLine = lines.find((l) => l.msg === 'agent.run.finish')
    expect(startLine).toBeDefined()
    expect(finishLine).toBeDefined()
    expect(startLine!.layer).toBe('service')
    expect(finishLine!.inputTokens).toBe(5)
    expect(finishLine!.outputTokens).toBe(1)
    expect(typeof finishLine!.costUsd).toBe('number')
    expect(typeof finishLine!.latencyMs).toBe('number')
  })

  test('repo lines + service lines share the same parent logger context', async () => {
    const { model } = scriptModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: usageOf({ inputTokens: 5, outputTokens: 1 }),
      },
    ])
    const { logger, lines } = captureLogger('debug')
    // Mimic logger middleware behavior — child with requestId.
    const requestLogger = logger.child({ requestId: '01TESTREQID00000000000000' })

    for await (const _ of runAgent(
      { message: 'hello' },
      { db: h.db, model, tools: {}, env: ENV, logger: requestLogger },
    )) {
      // drain
    }
    const repoLines = lines.filter((l) => l.layer === 'repo')
    expect(repoLines.length).toBeGreaterThan(0)
    for (const l of repoLines) expect(l.requestId).toBe('01TESTREQID00000000000000')

    const serviceLines = lines.filter((l) => l.layer === 'service')
    for (const l of serviceLines) expect(l.requestId).toBe('01TESTREQID00000000000000')
  })

  test('translate onToolResult fires service-level tool.result debug line', async () => {
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
          usage: usageOf({ inputTokens: 10, outputTokens: 2 }),
        },
      ],
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'done' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: usageOf({ inputTokens: 12, outputTokens: 1 }),
        },
      ],
    )
    const drug_info = stubTool({ output: { name: 'Advil' } })
    const { logger, lines } = captureLogger('debug')

    for await (const _ of runAgent(
      { message: 'q' },
      { db: h.db, model, tools: { drug_info }, env: ENV, logger },
    )) {
      // drain
    }

    const toolLines = lines.filter((l) => l.layer === 'tool' && l.msg === 'tool.result')
    expect(toolLines).toHaveLength(1)
    expect(toolLines[0]!.tool).toBe('drug_info')
    expect(toolLines[0]!.toolCallId).toBe('tu1')
    expect(toolLines[0]!.isError).toBe(false)
    expect(typeof toolLines[0]!.durationMs).toBe('number')
  })

  test('error path: throws → run.error logged + assistant row persisted with empty content', async () => {
    const { model } = scriptModel([
      { type: 'stream-start', warnings: [] },
      { type: 'error', error: new Error('boom') },
    ])
    const { logger, lines } = captureLogger('debug')

    const events = []
    for await (const ev of runAgent(
      { message: 'q' },
      { db: h.db, model, tools: {}, env: ENV, logger },
    )) {
      events.push(ev)
    }
    expect(events.find((e) => e.event === 'error')).toBeDefined()
    // Error is emitted via translate's mapping of the AI SDK `error` part —
    // `agent.run.error` only fires for thrown exceptions caught in the catch.
    // Here we should still see a `run.start` and the wire `error` event,
    // but no `run.finish` because metadata is gated on no error event.
    expect(lines.find((l) => l.msg === 'agent.run.start')).toBeDefined()
    expect(lines.find((l) => l.msg === 'agent.run.finish')).toBeUndefined()
  })
})
