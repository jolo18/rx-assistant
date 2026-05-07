export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_TARGET'
  | 'NOT_FOUND'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_TRUNCATED'
  | 'CONTENT_FILTERED'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN_MODEL'
  | 'INTERNAL'
  | 'RATE_LIMITED'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function httpError(status: number, code: ErrorCode, message: string): HttpError {
  return new HttpError(status, code, message)
}

/** Boot-time invariant failure when env.OPENROUTER_MODEL isn't in pricing.ts (Step 0.5 #6). */
export class UnknownModelError extends HttpError {
  constructor(public readonly model: string) {
    super(500, 'UNKNOWN_MODEL', `model ${model} is not in pricing.ts; refusing to start`)
    this.name = 'UnknownModelError'
  }
}

export type HttpEnvelope = {
  error: { code: ErrorCode; message: string; details?: unknown }
}

export function toHttpEnvelope(err: unknown): HttpEnvelope {
  if (err instanceof HttpError) {
    return { error: { code: err.code, message: err.message } }
  }
  const message = err instanceof Error ? err.message : 'unknown error'
  return { error: { code: 'INTERNAL', message } }
}

/** Wire-format error event payload — Step 0.6 dropped `recoverable`. */
export type ErrorEvent = { code: ErrorCode; message: string }

export function toErrorEvent(err: unknown): ErrorEvent {
  if (err instanceof HttpError) {
    return { code: err.code, message: err.message }
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return { code: 'UPSTREAM_TIMEOUT', message: err.message || 'upstream aborted' }
    }
    return { code: 'UPSTREAM_ERROR', message: err.message }
  }
  return { code: 'UPSTREAM_ERROR', message: 'unknown upstream error' }
}
