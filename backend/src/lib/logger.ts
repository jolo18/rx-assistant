import pino from 'pino'
import type { Env } from '../env.ts'

export type Logger = pino.Logger

/**
 * Boot-time root logger. Honors `LOG_LEVEL` and (when `LOG_PRETTY=true`)
 * pipes through pino-pretty for human-readable dev output. Production
 * always emits structured JSON to stdout.
 */
export function makeLogger(env: Pick<Env, 'LOG_LEVEL' | 'LOG_PRETTY'>): Logger {
  if (env.LOG_PRETTY) {
    return pino({
      level: env.LOG_LEVEL,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: true,
        },
      },
    })
  }
  return pino({ level: env.LOG_LEVEL })
}

/**
 * Per-request child logger — `requestId` is baked into every line so logs
 * across http / service / repo / tool layers correlate cleanly.
 */
export function childForRequest(parent: Logger, requestId: string): Logger {
  return parent.child({ requestId })
}

/** Silent no-op logger — used as the default when injection is optional. */
export const noopLogger: Logger = pino({ level: 'silent', enabled: false })
