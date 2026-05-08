import { Info } from './icons'

export function CappedNotice() {
  return (
    <div className="rx-capped">
      <Info size={14} />
      <span className="t-caption">
        Stopped after the maximum number of reasoning steps.
      </span>
    </div>
  )
}
