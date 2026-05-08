import { Caret } from './Caret'
import { ChevronDown } from './icons'

export type ReasoningPanelState =
  | 'streaming-collapsed'
  | 'streaming-expanded'
  | 'settled-collapsed'
  | 'settled-expanded'

type ReasoningPanelProps = {
  state?: ReasoningPanelState
  text?: string
  reducedMotion?: boolean
  onToggle?: () => void
}

export function ReasoningPanel({
  state = 'settled-collapsed',
  text,
  reducedMotion = false,
  onToggle,
}: ReasoningPanelProps) {
  const streaming = state.startsWith('streaming')
  const expanded = state.endsWith('expanded')
  return (
    <div className={'rx-reasoning' + (expanded ? ' is-expanded' : '')}>
      <button
        type="button"
        className="rx-reasoning__head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          className={
            'rx-reasoning__dot' +
            (streaming ? ' is-streaming' : '') +
            (reducedMotion ? ' is-reduced' : '')
          }
          aria-hidden="true"
        />
        <span className="t-label">{streaming ? 'Thinking…' : 'Thoughts'}</span>
        <span className="rx-reasoning__chev" aria-hidden="true">
          <ChevronDown size={14} />
        </span>
      </button>
      {expanded && (
        <div className="rx-reasoning__body">
          <p className="t-body-sm">
            {text}
            {streaming && <Caret />}
          </p>
        </div>
      )}
    </div>
  )
}
