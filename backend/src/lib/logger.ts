import pino from 'pino'
import type { Env } from '../env.ts'

export type Logger = pino.Logger

export function makeLogger(env: Pick<Env, 'LOG_LEVEL'>): Logger {
  return pino({ level: env.LOG_LEVEL })
}
