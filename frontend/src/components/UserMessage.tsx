import { More } from './icons'

type UserMessageProps = {
  text: string
  time?: string
  showHover?: boolean
  onMore?: () => void
}

export function UserMessage({ text, time = '', showHover = false, onMore }: UserMessageProps) {
  return (
    <div className={'rx-msg rx-msg--user' + (showHover ? ' is-hover' : '')}>
      <div className="rx-bubble">
        <div className="t-body-md">{text}</div>
      </div>
      <div className="rx-msg__footer">
        {time && (
          <span className="t-caption" style={{ color: 'var(--text-secondary)' }}>
            {time}
          </span>
        )}
        <button
          type="button"
          className="rx-iconbtn rx-msg__more"
          title="More"
          aria-label="More actions"
          onClick={onMore}
        >
          <More size={16} />
        </button>
      </div>
    </div>
  )
}
