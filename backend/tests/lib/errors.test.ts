import { describe, expect, test } from 'bun:test'
import {
  HttpError,
  UnknownModelError,
  toErrorEvent,
  toHttpEnvelope,
} from '../../src/lib/errors'

describe('HttpError', () => {
  test('exposes status, code, message', () => {
    const err = new HttpError(400, 'INVALID_INPUT', 'message must be non-empty')
    expect(err.status).toBe(400)
    expect(err.code).toBe('INVALID_INPUT')
    expect(err.message).toBe('message must be non-empty')
    expect(err).toBeInstanceOf(Error)
  })

  test('toHttpEnvelope returns the canonical { error: { code, message } } shape', () => {
    const err = new HttpError(404, 'NOT_FOUND', 'no such conversation')
    expect(toHttpEnvelope(err)).toEqual({
      error: { code: 'NOT_FOUND', message: 'no such conversation' },
    })
  })

  test('toHttpEnvelope wraps unknown errors as INTERNAL', () => {
    const env = toHttpEnvelope(new Error('boom'))
    expect(env.error.code).toBe('INTERNAL')
    expect(typeof env.error.message).toBe('string')
  })
})

describe('UnknownModelError', () => {
  test('is a distinct subclass of HttpError', () => {
    const err = new UnknownModelError('unknown/model')
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toBeInstanceOf(UnknownModelError)
    expect(err.status).toBe(500)
    expect(err.code).toBe('UNKNOWN_MODEL')
    expect(err.model).toBe('unknown/model')
  })
})

describe('toErrorEvent (SSE error payload)', () => {
  test('HttpError → { code, message } for the wire (no recoverable, Step 0.6)', () => {
    const ev = toErrorEvent(new HttpError(504, 'UPSTREAM_TIMEOUT', 'gone too long'))
    expect(ev).toEqual({ code: 'UPSTREAM_TIMEOUT', message: 'gone too long' })
  })

  test('AbortError → UPSTREAM_TIMEOUT (F-2 / F-11 surface)', () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    const ev = toErrorEvent(e)
    expect(ev.code).toBe('UPSTREAM_TIMEOUT')
  })

  test('plain Error → UPSTREAM_ERROR', () => {
    const ev = toErrorEvent(new Error('boom'))
    expect(ev.code).toBe('UPSTREAM_ERROR')
    expect(ev.message).toBe('boom')
  })
})
