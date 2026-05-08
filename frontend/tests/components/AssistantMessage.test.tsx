import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AssistantMessage } from '../../src/components/AssistantMessage'
import type { AssistantMessageInProgress } from '../../src/hooks/useChatStream'

function baseAssistant(overrides: Partial<AssistantMessageInProgress> = {}): AssistantMessageInProgress {
  return {
    messageId: 'a1',
    userMessageId: 'u1',
    conversationId: 'c1',
    model: 'm',
    reasoning: { open: false, text: '', done: false },
    toolCalls: [],
    text: '',
    steps: [],
    ...overrides,
  }
}

const settledMetadata = {
  type: 'metadata' as const,
  messageId: 'a1',
  model: 'sonnet-4.6',
  inputTokens: 12,
  outputTokens: 8,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  latencyMs: 100,
  costUsd: 0.0001,
}

describe('AssistantMessage', () => {
  test('done phase renders text + metadata footer', () => {
    const a = baseAssistant({ text: 'Hello world', metadata: settledMetadata })
    render(<AssistantMessage assistant={a} phase="done" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('sonnet-4.6')).toBeInTheDocument()
    expect(screen.getByText(/12 in/)).toBeInTheDocument()
  })

  test('streaming with reasoning + tool + partial text shows expected blocks', () => {
    const a = baseAssistant({
      reasoning: { open: true, text: '…thinking', done: false },
      toolCalls: [
        {
          id: 't1',
          name: 'drug_info',
          state: 'running',
          partialInput: '',
        },
      ],
      text: 'Partial',
    })
    const { container } = render(<AssistantMessage assistant={a} phase="streaming" liveCapped />)
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(container.querySelector('.rx-reasoning')).toHaveClass('is-expanded')
    expect(container.querySelector('.rx-tool.is-running')).toBeInTheDocument()
    expect(screen.getByText('Partial')).toBeInTheDocument()
    expect(container.querySelector('.rx-caret')).toBeInTheDocument()
  })

  test('renders CappedNotice when liveCapped + last step.reason === capped', () => {
    const a = baseAssistant({
      text: '',
      steps: [{ index: 1, reason: 'capped' }],
      metadata: settledMetadata,
    })
    render(<AssistantMessage assistant={a} phase="done" liveCapped />)
    expect(screen.getByText(/Stopped after the maximum/i)).toBeInTheDocument()
  })

  test('does NOT render CappedNotice in history path (liveCapped=false)', () => {
    const a = baseAssistant({
      text: '',
      steps: [{ index: 1, reason: 'capped' }],
      metadata: settledMetadata,
    })
    render(<AssistantMessage assistant={a} phase="done" liveCapped={false} />)
    expect(screen.queryByText(/Stopped after the maximum/i)).toBeNull()
  })

  test('error phase with code renders ErrorPill with mapped copy', () => {
    const a = baseAssistant()
    render(
      <AssistantMessage
        assistant={a}
        phase="error"
        errorCode="UPSTREAM_TIMEOUT"
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Took too long to respond/)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  test('done with successful tool call shows duration string', () => {
    const a = baseAssistant({
      toolCalls: [
        {
          id: 't1',
          name: 'drug_info',
          state: 'complete-success',
          partialInput: '',
          durationMs: 740,
        },
      ],
      text: 'ok',
      metadata: settledMetadata,
    })
    render(<AssistantMessage assistant={a} phase="done" />)
    expect(screen.getByText('0.7s')).toBeInTheDocument()
  })

  test('history path (no metadata, no live flags) renders body without footer or pill', () => {
    const a = baseAssistant({ text: 'historical' })
    render(<AssistantMessage assistant={a} phase="done" liveCapped={false} />)
    expect(screen.getByText('historical')).toBeInTheDocument()
    expect(screen.queryByText(/in \//)).toBeNull() // no MessageFooter
    expect(screen.queryByRole('alert')).toBeNull() // no ErrorPill
  })
})
