import pino from 'pino'
import type { Logger } from '../../src/lib/logger'

export type CapturedLine = Record<string, unknown>

/**
 * pino → array, one parsed line per call. The destination satisfies pino's
 * stream-like contract (a `write(s: string)` method). Tests can assert on the
 * captured object stream without spinning up a real transport.
 */
export function captureLogger(level: pino.Level = 'debug'): {
  logger: Logger
  lines: CapturedLine[]
} {
  const lines: CapturedLine[] = []
  const dest = {
    write(chunk: string) {
      try {
        lines.push(JSON.parse(chunk))
      } catch {
        lines.push({ raw: chunk })
      }
    },
  }
  return { logger: pino({ level }, dest), lines }
}
