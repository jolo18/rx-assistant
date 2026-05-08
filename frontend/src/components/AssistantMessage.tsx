/**
 * Renders one assistant turn — same component for live streaming
 * (useChatStream state) and historical replay (groupIntoTurns output)
 * because both produce an `AssistantMessageInProgress`-shaped value.
 *
 * Live-only adornments (CappedNotice, ErrorPill) are explicit props the
 * consumer chooses to pass — see spec §1.4 limitations L1/L2: persisted
 * history doesn't have access to step.reason or the terminal error code.
 */

import { useEffect, useState } from 'react'
import type { AssistantMessageInProgress, ToolCallSlot } from '../hooks/useChatStream'
import { useTts } from '../hooks/useTts'
import type { ErrorCode, ToolResultOutput } from '../lib/chat-events'
import { AnswerBody } from './AnswerBody'
import { AudioPlayer } from './AudioPlayer'
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
  /**
   * When true and `phase === 'done'`, mount <AudioPlayer> next to the footer
   * and auto-play the assistant text via Web Speech Synthesis.
   */
  ttsOn?: boolean
  /**
   * When true (and ttsOn), the player kicks off speech automatically as soon
   * as the message settles. Default true. The historical-replay path that
   * doesn't want auto-play (e.g. retroactive toggle on a long page of past
   * messages) passes `false` and gets a manual play button instead.
   */
  ttsAutoPlay?: boolean
}

export function AssistantMessage({
  assistant,
  phase,
  liveCapped = false,
  errorCode,
  errorMessage,
  onRetry,
  ttsOn = false,
  ttsAutoPlay = true,
}: AssistantMessageProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  // null = follow the auto-state (expanded while streaming, collapsed once
  // settled). true/false = user has explicitly toggled.
  const [reasoningOverride, setReasoningOverride] = useState<boolean | null>(null)

  const tts = useTts()
  // Track whether we've already auto-played for this messageId — we don't
  // want to re-fire on every re-render of a settled turn.
  const [autoPlayedFor, setAutoPlayedFor] = useState<string | null>(null)
  useEffect(() => {
    if (!ttsOn || !ttsAutoPlay) return
    if (phase !== 'done') return
    if (!assistant.text) return
    if (autoPlayedFor === assistant.messageId) return
    setAutoPlayedFor(assistant.messageId)
    tts.play(assistant.text)
    // tts.play is stable enough across renders (state-machine internals own
    // their own refs); we intentionally exclude it from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsOn, ttsAutoPlay, phase, assistant.messageId, assistant.text, autoPlayedFor])

  // When the consumer flips ttsOn off mid-utterance, stop playback.
  useEffect(() => {
    if (!ttsOn && tts.state.status === 'speaking') {
      tts.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsOn])
  const settled = phase !== 'streaming'
  const hasReasoning = assistant.reasoning.text.length > 0
  const lastStep = assistant.steps.at(-1)
  const showCapped = liveCapped && lastStep?.reason === 'capped'

  const streamingReasoning = hasReasoning && !assistant.reasoning.done
  const reasoningExpanded =
    reasoningOverride !== null ? reasoningOverride : streamingReasoning
  const reasoningState: ReasoningPanelState = streamingReasoning
    ? reasoningExpanded
      ? 'streaming-expanded'
      : 'streaming-collapsed'
    : reasoningExpanded
      ? 'settled-expanded'
      : 'settled-collapsed'

  return (
    <article className="rx-amsg">
      <div className="rx-amsg__blocks">
        {hasReasoning && (
          <ReasoningPanel
            state={reasoningState}
            text={assistant.reasoning.text}
            onToggle={() => setReasoningOverride(!reasoningExpanded)}
          />
        )}

        {assistant.toolCalls.map((tc) => (
          <ToolCallSlotRenderer key={tc.id} tc={tc} settled={settled} />
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

        {phase === 'done' && ttsOn && assistant.text && (
          <AudioPlayerSlot
            playing={tts.state.status === 'speaking'}
            progress={
              tts.state.status === 'speaking' || tts.state.status === 'paused'
                ? tts.state.totalChars > 0
                  ? tts.state.charIndex / tts.state.totalChars
                  : 0
                : 0
            }
            onPlayPause={() => {
              if (tts.state.status === 'idle' || tts.state.status === 'error') {
                tts.play(assistant.text)
              } else if (tts.state.status === 'paused') {
                tts.resume()
              } else if (tts.state.status === 'speaking') {
                tts.pause()
              }
            }}
            unsupported={tts.state.status === 'unsupported'}
          />
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
            showMenu={menuOpen}
            copied={copied}
            onMore={() => setMenuOpen((o) => !o)}
            onCloseMenu={() => setMenuOpen(false)}
            onCopy={async () => {
              setMenuOpen(false)
              try {
                await navigator.clipboard.writeText(assistant.text)
                setCopied(true)
              } catch {
                // Clipboard API unavailable / permission denied — silent no-op.
              }
            }}
          />
        )}
      </div>
    </article>
  )
}

function AudioPlayerSlot({
  playing,
  progress,
  onPlayPause,
  unsupported,
}: {
  playing: boolean
  progress: number
  onPlayPause: () => void
  unsupported: boolean
}) {
  if (unsupported) return null
  return <AudioPlayer variant="compact" playing={playing} progress={progress} onPlayPause={onPlayPause} />
}

/**
 * One ToolCall row — owns its own expand + raw-view state so multiple tool
 * calls in the same turn don't share toggles.
 */
function ToolCallSlotRenderer({ tc, settled }: { tc: ToolCallSlot; settled: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [rawView, setRawView] = useState(false)

  const duration =
    settled && tc.state === 'complete-success' && tc.durationMs
      ? `${(tc.durationMs / 1000).toFixed(1)}s`
      : undefined

  const inputJson =
    tc.input !== undefined ? JSON.stringify(tc.input, null, 2) : tc.partialInput
  const outputJson = tc.output !== undefined ? JSON.stringify(tc.output, null, 2) : ''

  return (
    <ToolCall
      name={tc.name}
      state={tc.state}
      duration={duration}
      expanded={expanded}
      rawView={rawView}
      input={inputJson}
      output={outputJson}
      outputValue={tc.output as ToolResultOutput | undefined}
      onToggleExpanded={() => setExpanded((e) => !e)}
      onToggleRaw={() => setRawView((r) => !r)}
    />
  )
}
