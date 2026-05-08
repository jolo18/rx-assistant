/**
 * Renders one assistant turn — same component for live streaming
 * (useChatStream state) and historical replay (groupIntoTurns output)
 * because both produce an `AssistantMessageInProgress`-shaped value.
 *
 * Live-only adornments (CappedNotice, ErrorPill) are explicit props the
 * consumer chooses to pass — see spec §1.4 limitations L1/L2: persisted
 * history doesn't have access to step.reason or the terminal error code.
 */

import type { AssistantMessageInProgress } from '../hooks/useChatStream'
import type { ErrorCode } from '../lib/chat-events'
import { AnswerBody } from './AnswerBody'
import { Caret } from './Caret'
import { CappedNotice } from './CappedNotice'
import { ErrorPill } from './ErrorPill'
import { MessageFooter } from './MessageFooter'
import { ReasoningPanel, type ReasoningPanelState } from './ReasoningPanel'
import { ToolCall } from './ToolCall'

type AssistantMessageProps = {
  assistant: AssistantMessageInProgress
  phase: 'streaming' | 'done' | 'error'
  /** When true, surfaces <CappedNotice> if the last step.reason === 'capped'. */
  liveCapped?: boolean
  /** Live-only error code; surfaces <ErrorPill>. Undefined for history paths. */
  errorCode?: ErrorCode
  errorMessage?: string
  onRetry?: () => void
}

export function AssistantMessage({
  assistant,
  phase,
  liveCapped = false,
  errorCode,
  errorMessage,
  onRetry,
}: AssistantMessageProps) {
  const settled = phase !== 'streaming'
  const hasReasoning = assistant.reasoning.text.length > 0
  const lastStep = assistant.steps.at(-1)
  const showCapped = liveCapped && lastStep?.reason === 'capped'

  const reasoningState: ReasoningPanelState = hasReasoning
    ? assistant.reasoning.done
      ? 'settled-collapsed'
      : 'streaming-expanded'
    : 'settled-collapsed'

  return (
    <article className="rx-amsg">
      <div className="rx-amsg__blocks">
        {hasReasoning && (
          <ReasoningPanel state={reasoningState} text={assistant.reasoning.text} />
        )}

        {assistant.toolCalls.map((tc) => (
          <ToolCall
            key={tc.id}
            name={tc.name}
            state={tc.state}
            duration={
              settled && tc.state === 'complete-success' && tc.durationMs
                ? `${(tc.durationMs / 1000).toFixed(1)}s`
                : undefined
            }
          />
        ))}

        {assistant.text && (
          <div style={{ position: 'relative' }}>
            <AnswerBody text={assistant.text} settled={settled} />
            {phase === 'streaming' && <Caret />}
          </div>
        )}

        {/* Streaming text with no body yet — show the caret on its own line. */}
        {phase === 'streaming' && !assistant.text && assistant.toolCalls.length > 0 && (
          <Caret />
        )}

        {showCapped && <CappedNotice />}

        {errorCode && (
          <ErrorPill code={errorCode} message={errorMessage} onRetry={onRetry} />
        )}

        {phase === 'done' && assistant.metadata && (
          <MessageFooter
            model={assistant.metadata.model}
            tokensIn={assistant.metadata.inputTokens}
            tokensOut={assistant.metadata.outputTokens}
            cached={
              assistant.metadata.cacheReadTokens > 0
                ? assistant.metadata.cacheReadTokens
                : undefined
            }
            cost={assistant.metadata.costUsd}
          />
        )}
      </div>
    </article>
  )
}
