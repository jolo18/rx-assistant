import { useEffect, useRef } from 'react'
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
  /** Outside-click / Esc dismiss. Called whenever the menu should close. */
  onCloseMenu?: () => void
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
  onCloseMenu,
  onCopy,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: MessageFooterProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Close the menu on click outside / Esc. Only registers handlers while
  // the menu is actually visible so closed-state has zero listener cost.
  // Skipped while the inline confirm row is showing — that state is
  // dismissed via its explicit Cancel / Delete buttons.
  useEffect(() => {
    if (!showMenu || confirmingDelete) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        onCloseMenu?.()
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMenu?.()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [showMenu, confirmingDelete, onCloseMenu])

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
      <span className="rx-mfooter__menuanchor" ref={menuRef}>
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
            <span className="t-caption rx-confirm__prompt">Delete this turn?</span>
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
      </span>
    </div>
  )
}
