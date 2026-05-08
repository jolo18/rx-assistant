/**
 * §1.4 limitations L1, L2, L3: reloading a conversation displays only the
 * structural data the backend persists. CappedNotice and ErrorPill are
 * live-only; tool durations are not persisted (badge falls back to
 * "Complete" when there's no durationMs).
 */

import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AssistantMessage } from '../../src/components/AssistantMessage'
import { groupIntoTurns, type HistoryMessage } from '../../src/lib/turns'

describe('reload-history — L1/L2/L3 documented degradations', () => {
  test('historical capped turn renders without <CappedNotice> (L1)', () => {
    // Persisted history has no step records — they're wire-only. Even if a
    // turn was capped at stream time, the reload doesn't have access to
    // step.reason. Pass liveCapped=false (the history default).
    const messages: HistoryMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'foo',
        position: 0,
        createdAt: 'x',
      },
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'partial answer' }],
        position: 1,
        createdAt: 'y',
        usage: { inputTokens: 1, outputTokens: 1, model: 'm' },
      },
    ]
    const turn = groupIntoTurns(messages)[0]!.assistant!
    render(<AssistantMessage assistant={turn} phase="done" liveCapped={false} />)
    expect(screen.queryByText(/Stopped after the maximum/i)).toBeNull()
  })

  test('historical errored turn renders without <ErrorPill> (L2)', () => {
    const messages: HistoryMessage[] = [
      { id: 'u1', role: 'user', content: 'foo', position: 0, createdAt: 'x' },
      // Per F-12: assistant row persisted with empty content on terminal error.
      {
        id: 'a1',
        role: 'assistant',
        content: [],
        position: 1,
        createdAt: 'y',
      },
    ]
    const turn = groupIntoTurns(messages)[0]!.assistant!
    render(<AssistantMessage assistant={turn} phase="done" />)
    // No errorCode prop — history has no terminal error code to plumb.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('historical tool call: badge label without persisted duration (L3)', () => {
    const messages: HistoryMessage[] = [
      { id: 'u1', role: 'user', content: 'foo', position: 0, createdAt: 'x' },
      {
        id: 'a1',
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tu1', toolName: 'drug_info', input: { q: 'ibuprofen' } },
        ],
        position: 1,
        createdAt: 'y',
      },
      {
        id: 'tr1',
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tu1',
            toolName: 'drug_info',
            output: { type: 'json', value: { name: 'ibuprofen' } },
          },
        ],
        position: 2,
        createdAt: 'z',
      },
      {
        id: 'a2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Ibuprofen treats pain.' }],
        position: 3,
        createdAt: 'w',
        usage: { inputTokens: 10, outputTokens: 5, model: 'sonnet-4.6' },
      },
    ]
    const turn = groupIntoTurns(messages)[0]!.assistant!
    render(<AssistantMessage assistant={turn} phase="done" />)

    // No durationMs persisted → badge falls back to the default "Complete" label.
    expect(screen.getByText('Complete')).toBeInTheDocument()
    // And NOT a fake duration like "0.7s"
    expect(screen.queryByText(/0\.\ds/)).toBeNull()
  })

  test('history path renders MessageFooter from synthesized metadata (model + usage)', () => {
    const messages: HistoryMessage[] = [
      { id: 'u1', role: 'user', content: 'foo', position: 0, createdAt: 'x' },
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        position: 1,
        createdAt: 'y',
        usage: { inputTokens: 12, outputTokens: 8, model: 'sonnet-4.6', costUsd: 0.0001 },
      },
    ]
    const turn = groupIntoTurns(messages)[0]!.assistant!
    render(<AssistantMessage assistant={turn} phase="done" />)
    expect(screen.getByText('sonnet-4.6')).toBeInTheDocument()
    expect(screen.getByText(/12 in/)).toBeInTheDocument()
  })
})
