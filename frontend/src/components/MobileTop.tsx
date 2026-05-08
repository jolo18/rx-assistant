import { Edit, Menu } from './icons'

type MobileTopProps = {
  title?: string
  onOpenMenu?: () => void
  onNewChat?: () => void
}

export function MobileTop({ title = 'Rx Assistant', onOpenMenu, onNewChat }: MobileTopProps) {
  return (
    <div className="rx-mobiletop">
      <button
        type="button"
        className="rx-mobiletop__btn"
        aria-label="Open menu"
        onClick={onOpenMenu}
      >
        <Menu size={18} />
      </button>
      <div className="rx-mobiletop__brand">
        <span className="rx-brand__mark" aria-hidden="true" style={{ width: 18, height: 18 }} />
        <span className="t-label">{title}</span>
      </div>
      <button
        type="button"
        className="rx-mobiletop__btn"
        aria-label="New chat"
        onClick={onNewChat}
      >
        <Edit size={18} />
      </button>
    </div>
  )
}
