/**
 * Minimal SSE protocol parser for fetch().body. EventSource doesn't support
 * POST, which we need for /api/chat, so we hand-parse `event:` / `data:`
 * frames per the WHATWG spec subset that the backend emits.
 *
 * Yields one frame per `\n\n` (or EOF). Comment lines (`:`) are ignored.
 */

export type SSEFrame = {
  event: string
  data: string
}

const NEWLINE = /\r\n|\r|\n/

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEFrame, void, unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(value, { stream: true })

      let frameEnd: number
      while ((frameEnd = findFrameBoundary(buffer)) !== -1) {
        const raw = buffer.slice(0, frameEnd.valueOf())
        buffer = buffer.slice(advancePast(buffer, frameEnd))
        const frame = parseFrame(raw)
        if (frame) yield frame
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Flush a trailing frame with no terminating blank line (EOF mid-frame).
  if (buffer.length > 0) {
    const frame = parseFrame(buffer)
    if (frame) yield frame
  }
}

/**
 * Find the index where a frame boundary begins (`\n\n`, `\r\n\r\n`, or `\r\r`).
 * Returns -1 if no boundary in the buffer yet.
 */
function findFrameBoundary(buffer: string): number {
  // Order matters: check the longest sequence first to avoid splitting `\r\n\r\n`
  // into two `\r` boundaries.
  const lf2 = buffer.indexOf('\n\n')
  const crlf2 = buffer.indexOf('\r\n\r\n')
  const cr2 = buffer.indexOf('\r\r')

  const candidates = [lf2, crlf2, cr2].filter((i) => i !== -1)
  if (candidates.length === 0) return -1
  return Math.min(...candidates)
}

/** How many characters past `frameEnd` should we drop to skip the blank line. */
function advancePast(buffer: string, frameEnd: number): number {
  if (buffer.startsWith('\r\n\r\n', frameEnd)) return frameEnd + 4
  if (buffer.startsWith('\n\n', frameEnd)) return frameEnd + 2
  if (buffer.startsWith('\r\r', frameEnd)) return frameEnd + 2
  // Defensive: shouldn't happen given findFrameBoundary checks above.
  return frameEnd + 2
}

function parseFrame(raw: string): SSEFrame | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of raw.split(NEWLINE)) {
    if (line.length === 0) continue
    if (line.startsWith(':')) continue // comment / heartbeat

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    // Per SSE spec: a single leading space after the colon is stripped.
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') {
      event = value
    } else if (field === 'data') {
      dataLines.push(value)
    }
    // `id` and `retry` aren't used by our wire format; ignore silently.
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
