import type { ErrorCode } from '../lib/chat-events'
import { Alert } from './icons'

const ERROR_COPY: Partial<Record<ErrorCode, string>> = {
  UPSTREAM_TIMEOUT: 'Took too long to respond. Try again.',
  UPSTREAM_TRUNCATED: 'The response was cut short — try a more specific question.',
  CONTENT_FILTERED: 'The response was filtered for safety. Try rephrasing.',
  RATE_LIMITED: 'Service is busy. Try again in a moment.',
  NETWORK_ERROR: "Couldn't reach the server. Check your connection.",
  UPSTREAM_ERROR: 'Something went wrong while generating.',
  INTERNAL: 'Something unexpected happened on our side.',
}

type ErrorPillProps = {
  code?: ErrorCode
  /** Falls back to this string if `code` isn't in the table; defaults to a generic. */
  message?: string
  onRetry?: () => void
}

export function ErrorPill({ code, message, onRetry }: ErrorPillProps) {
  const copy = (code && ERROR_COPY[code]) ?? message ?? 'Something went wrong while generating.'
  return (
    <div className="rx-errorpill" role="alert">
      <Alert size={14} />
      <span className="t-body-md">{copy}</span>
      {onRetry && (
        <button type="button" className="rx-errorpill__retry t-label" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
