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
  /** When true, replaces the menu with an inline Cancel / Delete confirm row. */
  confirmingDelete?: boolean
  onMore?: () => void
  onCopy?: () => void
  onDelete?: () => void
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
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
  confirmingDelete = false,
  onMore,
  onCopy,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
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
      {showMenu && !confirmingDelete && (
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
      {confirmingDelete && (
        <span className="rx-confirm" role="alertdialog" aria-label="Confirm delete turn">
          <span className="t-caption">Delete this turn?</span>
          <button type="button" className="rx-confirm__btn" onClick={onCancelDelete}>
            Cancel
          </button>
          <button
            type="button"
            className="rx-confirm__btn rx-confirm__btn--danger"
            onClick={onConfirmDelete}
          >
            <Trash size={12} /> Delete
          </button>
        </span>
      )}
    </div>
  )
}
