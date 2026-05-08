import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ApiError, ConversationSummary } from '../lib/api'
import { Edit, More, Plus, Sidebar as SidebarIcon, Trash } from './icons'
import { ThemeToggle } from './ThemeToggle'

type SidebarProps = {
  conversations: ConversationSummary[]
  loading?: boolean
  error?: ApiError | null
  collapsed?: boolean
  mobile?: boolean
  onToggleCollapsed?: () => void
  onNewChat?: () => void
  onDelete: (id: string) => Promise<unknown>
}

export function Sidebar({
  conversations,
  loading = false,
  error = null,
  collapsed = false,
  mobile = false,
  onToggleCollapsed,
  onNewChat,
  onDelete,
}: SidebarProps) {
  const { id: activeId } = useParams<{ id: string }>()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  if (collapsed) {
    return (
      <aside className="rx-sidebar rx-sidebar--collapsed" aria-label="Sidebar (collapsed)">
        <button
          type="button"
          className="rx-sidebar__toggle"
          aria-label="Open sidebar"
          onClick={onToggleCollapsed}
        >
          <SidebarIcon size={18} />
        </button>
        <button
          type="button"
          className="rx-sidebar__newicon"
          aria-label="New chat"
          title="New chat"
          onClick={onNewChat}
        >
          <Edit size={18} />
        </button>
        <div style={{ marginTop: 'auto' }}>
          <ThemeToggle />
        </div>
      </aside>
    )
  }

  const isEmpty = !loading && conversations.length === 0

  return (
    <aside
      className={'rx-sidebar' + (mobile ? ' rx-sidebar--mobile' : '')}
      aria-label="Conversations"
    >
      <div className="rx-sidebar__head">
        <div className="rx-sidebar__brand">
          <span className="rx-brand__mark" aria-hidden="true" />
          <span className="t-heading-sm">Rx Assistant</span>
        </div>
        <button
          type="button"
          className="rx-sidebar__toggle"
          aria-label="Collapse sidebar"
          onClick={onToggleCollapsed}
        >
          <SidebarIcon size={16} />
        </button>
      </div>

      <button type="button" className="rx-sidebar__new t-label" onClick={onNewChat}>
        <Plus size={14} />
        <span>New chat</span>
      </button>

      <div className="rx-sidebar__sectionlabel t-caption">Recent</div>

      <nav className="rx-sidebar__list" aria-label="Recent conversations">
        {error && (
          <p className="rx-sidebar__empty t-body-sm" role="alert">
            Couldn't load conversations.
          </p>
        )}
        {!error && isEmpty && (
          <p className="rx-sidebar__empty t-body-sm">No conversations yet.</p>
        )}
        {!error &&
          conversations.map((c) => {
            const active = c.id === activeId
            const isConfirming = confirmingId === c.id
            return (
              <Link
                key={c.id}
                to={`/c/${c.id}`}
                className={'rx-conv' + (active ? ' is-active' : '')}
                aria-current={active ? 'page' : undefined}
              >
                <span className="rx-conv__title t-label">{c.title ?? 'Untitled'}</span>
                <span className="rx-conv__time t-caption">
                  {formatRelative(c.updatedAt)}
                </span>
                {isConfirming ? (
                  <ConfirmDelete
                    onCancel={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setConfirmingId(null)
                    }}
                    onConfirm={async (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      await onDelete(c.id)
                      setConfirmingId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="rx-conv__more"
                    aria-label={`Delete ${c.title ?? 'conversation'}`}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setConfirmingId(c.id)
                    }}
                  >
                    <More size={14} />
                  </button>
                )}
              </Link>
            )
          })}
      </nav>

      <div className="rx-sidebar__foot">
        <ThemeToggle />
        <span className="t-caption">Single-user · informational only</span>
      </div>
    </aside>
  )
}

type ConfirmDeleteProps = {
  onCancel: (e: React.MouseEvent) => void
  onConfirm: (e: React.MouseEvent) => void | Promise<void>
}

function ConfirmDelete({ onCancel, onConfirm }: ConfirmDeleteProps) {
  return (
    <span className="rx-confirm" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="rx-confirm__btn"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        type="button"
        className="rx-confirm__btn rx-confirm__btn--danger"
        onClick={onConfirm}
      >
        <Trash size={12} /> Delete
      </button>
    </span>
  )
}

function formatRelative(isoString: string): string {
  const then = new Date(isoString).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = (Date.now() - then) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172_800) return 'Yesterday'
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
