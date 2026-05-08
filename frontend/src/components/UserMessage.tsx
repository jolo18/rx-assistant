import { useEffect, useRef, useState } from 'react'
import { Copy, More, Trash } from './icons'

type UserMessageProps = {
  text: string
  time?: string
  showHover?: boolean
  /**
   * Fired when the user confirms deletion of this turn. Backend deletes
   * this user-message id, which cascades through end-of-conversation.
   * When omitted (e.g. live in-flight pending user message), the Delete
   * item is hidden — only Copy is shown.
   */
  onDeleteTurn?: () => void | Promise<void>
}

export function UserMessage({ text, time = '', showHover = false, onDeleteTurn }: UserMessageProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])

  useEffect(() => {
    if (!menuOpen || confirming) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen, confirming])

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
        {copied && (
          <span className="t-caption rx-mfooter__copied" role="status" aria-live="polite">
            Copied
          </span>
        )}
        <span className="rx-msg__menuanchor" ref={menuRef}>
          <button
            type="button"
            className="rx-iconbtn rx-msg__more"
            title="More"
            aria-label="More actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <More size={16} />
          </button>
          {menuOpen && !confirming && (
            <div className="rx-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="rx-menu__item"
                onClick={async () => {
                  setMenuOpen(false)
                  try {
                    await navigator.clipboard.writeText(text)
                    setCopied(true)
                  } catch {
                    // Clipboard API unavailable / permission denied — silent no-op.
                  }
                }}
              >
                <Copy size={14} />
                <span className="t-label">Copy</span>
              </button>
              {onDeleteTurn && (
                <button
                  type="button"
                  role="menuitem"
                  className="rx-menu__item rx-menu__item--danger"
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirming(true)
                  }}
                >
                  <Trash size={14} />
                  <span className="t-label">Delete</span>
                </button>
              )}
            </div>
          )}
          {confirming && (
            <span className="rx-confirm" role="alertdialog" aria-label="Confirm delete from this turn">
              <span className="t-caption rx-confirm__prompt">Delete this and everything after?</span>
              <button
                type="button"
                className="rx-confirm__btn"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rx-confirm__btn rx-confirm__btn--danger"
                onClick={async () => {
                  setConfirming(false)
                  await onDeleteTurn?.()
                }}
              >
                <Trash size={12} /> Delete
              </button>
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
