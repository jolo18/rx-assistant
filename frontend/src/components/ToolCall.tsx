import type { ReactNode } from 'react'
import type { ToolCallState } from '../hooks/useChatStream'
import type { ToolResultOutput } from '../lib/chat-events'
import { Alert, Beaker, Check, ChevronDown, Sparkle, Stethoscope } from './icons'
import { FormattedToolOutput } from './FormattedToolOutput'

type ToolCallProps = {
  name: string
  state: ToolCallState
  /** Display string (e.g. "0.7s") shown next to the success badge. */
  duration?: string
  expanded?: boolean
  /** Pretty-printed JSON of the input arguments. */
  input?: string
  /** Pretty-printed JSON of the output (used in raw-view). */
  output?: string
  /** Structured output for the formatted view. */
  outputValue?: ToolResultOutput
  rawView?: boolean
  reducedMotion?: boolean
  onToggleExpanded?: () => void
  onToggleRaw?: () => void
  /** Optional override for the formatted-output body (used by tests / gallery). */
  children?: ReactNode
}

const TOOL_META: Record<string, { label: string; Icon: typeof Beaker }> = {
  drug_info: { label: 'drug_info', Icon: Beaker },
  symptom_lookup: { label: 'symptom_lookup', Icon: Stethoscope },
}

const STATE_TEXT: Record<ToolCallState, string> = {
  pending: 'Preparing input…',
  running: 'Calling tool…',
  'complete-success': 'Complete',
  'complete-error': 'Returned an error',
}

export function ToolCall({
  name,
  state,
  duration,
  expanded = false,
  input,
  output,
  outputValue,
  rawView = false,
  reducedMotion = false,
  onToggleExpanded,
  onToggleRaw,
  children,
}: ToolCallProps) {
  const meta = TOOL_META[name] ?? { label: name, Icon: Sparkle }
  const Icon = meta.Icon

  const stateClass = ' is-' + state.replace('complete-', 'done-')
  const stateText =
    state === 'complete-success' && duration ? duration : STATE_TEXT[state]

  return (
    <div className={'rx-tool' + stateClass + (expanded ? ' is-expanded' : '')}>
      <button
        type="button"
        className="rx-tool__pill"
        aria-expanded={expanded}
        onClick={onToggleExpanded}
      >
        <span className="rx-tool__icon">
          <Icon size={14} />
        </span>
        <span className="rx-tool__name t-label">{meta.label}</span>
        <span className="rx-tool__sep" aria-hidden="true">·</span>
        <StateBadge state={state} reducedMotion={reducedMotion} />
        <span className="rx-tool__state t-label">{stateText}</span>
        {(state === 'complete-success' || state === 'complete-error') && (
          <span className="rx-tool__chev" aria-hidden="true">
            <ChevronDown size={13} />
          </span>
        )}
      </button>
      {expanded && (
        <div className="rx-tool__body">
          <div className="rx-tool__section">
            <div className="rx-tool__sectionhead">
              <span className="t-label">Input</span>
            </div>
            <pre className="rx-tool__code t-code-b">{input ?? ''}</pre>
          </div>
          <div className="rx-tool__section">
            <div className="rx-tool__sectionhead">
              <span className="t-label">Output</span>
              <button
                type="button"
                className="rx-tool__rawtoggle t-caption"
                onClick={onToggleRaw}
              >
                {rawView ? 'View formatted' : 'View raw'}
              </button>
            </div>
            {children ??
              (rawView ? (
                <pre className="rx-tool__code t-code-b">{output ?? ''}</pre>
              ) : (
                <FormattedToolOutput name={name} state={state} output={outputValue} />
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StateBadge({
  state,
  reducedMotion,
}: {
  state: ToolCallState
  reducedMotion: boolean
}) {
  if (state === 'pending')
    return <span className="rx-pill__badge rx-pill__badge--pending" aria-hidden="true" />
  if (state === 'running')
    return (
      <span
        className={'rx-pill__spinner' + (reducedMotion ? ' is-reduced' : '')}
        aria-hidden="true"
      />
    )
  if (state === 'complete-success')
    return (
      <span className="rx-pill__badge rx-pill__badge--success" aria-hidden="true">
        <Check size={11} />
      </span>
    )
  return (
    <span className="rx-pill__badge rx-pill__badge--warn" aria-hidden="true">
      <Alert size={11} />
    </span>
  )
}
