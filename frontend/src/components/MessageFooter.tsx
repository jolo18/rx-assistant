import { useEffect, useRef } from 'react'
import { Copy, More } from './icons'

type MessageFooterProps = {
  time?: string
  model: string
  tokensIn: number
  tokensOut: number
  cached?: number
  cost: number
  capped?: boolean
  showMenu?: boolean
  /** When true, shows a transient "Copied" caption next to the actions button. */
  copied?: boolean
  onMore?: () => void
  /** Outside-click / Esc dismiss. Called whenever the menu should close. */
  onCloseMenu?: () => void
  onCopy?: () => void
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
  copied = false,
  onMore,
  onCloseMenu,
  onCopy,
}: MessageFooterProps) {
  const menuRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!showMenu) return
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
  }, [showMenu, onCloseMenu])

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
      {copied && (
        <span className="t-caption rx-mfooter__copied" role="status" aria-live="polite">
          Copied
        </span>
      )}
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
        {showMenu && (
          <div className="rx-menu" role="menu">
            <button type="button" role="menuitem" className="rx-menu__item" onClick={onCopy}>
              <Copy size={14} />
              <span className="t-label">Copy</span>
            </button>
          </div>
        )}
      </span>
    </div>
  )
}
