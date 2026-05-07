/**
 * Spec §3.2.1 wire encoder.
 *
 * One SSE frame = `event: <name>\n` + `data: <json>\n\n`.
 * `<json>` is `JSON.stringify(data)` — newlines inside string values are escaped
 * by JSON, so the payload always occupies a single `data:` line.
 *
 * Translated AI SDK fullStream parts → SSEEvent in `agent/translate.ts` (Slice 5).
 */
export type SSEEvent = { event: string; data: unknown }

const FORBIDDEN_NAME_CHARS = /[\n\r:]/

export function encode({ event, data }: SSEEvent): string {
  if (FORBIDDEN_NAME_CHARS.test(event) || event.length === 0) {
    throw new Error(`invalid SSE event name: ${JSON.stringify(event)}`)
  }
  return `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`
}
