type CaretProps = { paused?: boolean }

export function Caret({ paused = false }: CaretProps) {
  // 1.0s blink. When paused (e.g. tool running) the caret holds solid on so
  // the user still sees the streaming insertion point.
  return <span className={'rx-caret' + (paused ? ' is-paused' : '')} aria-hidden="true" />
}
