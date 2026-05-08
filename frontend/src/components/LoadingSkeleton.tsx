export function LoadingSkeleton() {
  return (
    <div className="rx-skeleton" aria-hidden="true">
      <div className="rx-skeleton__row rx-skeleton__row--user">
        <div className="rx-skel rx-skel--bubble" style={{ width: '60%' }} />
      </div>
      <div className="rx-skeleton__row">
        <div className="rx-skel" style={{ width: '30%', height: 16 }} />
        <div className="rx-skel" style={{ width: '85%', height: 14, marginTop: 12 }} />
        <div className="rx-skel" style={{ width: '75%', height: 14, marginTop: 6 }} />
        <div className="rx-skel" style={{ width: '60%', height: 14, marginTop: 6 }} />
      </div>
      <div className="rx-skeleton__row rx-skeleton__row--user">
        <div className="rx-skel rx-skel--bubble" style={{ width: '40%' }} />
      </div>
    </div>
  )
}
