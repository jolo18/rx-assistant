import { Copy, More, Trash } from './icons'

type MessageFooterProps = {
  time?: string
  model: string
  tokensIn: number
  tokensOut: number
  cached?: number
  cost: number
  capped?: boolean
  showMenu?: boolean
  onMore?: () => void
  onCopy?: () => void
  onDelete?: () => void
}

const tokens = (n: number) => n.toLocaleString('en-US')
const cost = (n: number) => (n < 0.0001 ? '<$0.0001' : '$' + n.toFixed(4))

export function MessageFooter({
  time = '',
  model,
  tokensIn,
  tokensOut,
  cached,
  cost: costUsd,
  showMenu = false,
  onMore,
  onCopy,
  onDelete,
}: MessageFooterProps) {
  return (
    <div className="rx-mfooter">
      {time && <span className="t-caption">{time}</span>}
      {time && <span className="rx-mfooter__sep">·</span>}
      <span className="t-caption">{model}</span>
      <span className="rx-mfooter__sep">·</span>
      <span className="t-caption">
        {tokens(tokensIn)} in
        {cached ? <span className="rx-mfooter__cached"> ({tokens(cached)} cached)</span> : null}
        {' / '}
        {tokens(tokensOut)} out
      </span>
      <span className="rx-mfooter__sep">·</span>
      <span className="t-caption">{cost(costUsd)}</span>
      <button
        type="button"
        className="rx-iconbtn rx-mfooter__more"
        aria-label="Message actions"
        aria-expanded={showMenu}
        onClick={onMore}
      >
        <More size={14} />
      </button>
      {showMenu && (
        <div className="rx-menu" role="menu">
          <button type="button" role="menuitem" className="rx-menu__item" onClick={onCopy}>
            <Copy size={14} />
            <span className="t-label">Copy</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="rx-menu__item rx-menu__item--danger"
            onClick={onDelete}
          >
            <Trash size={14} />
            <span className="t-label">Delete</span>
          </button>
        </div>
      )}
    </div>
  )
}
