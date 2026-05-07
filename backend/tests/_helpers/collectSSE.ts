export type SSEFrame = { event: string; data: unknown }

/**
 * Read an SSE response stream, parse `event:` / `data:` lines, return the
 * frames in order. Robust against multi-line chunks (a single `chunk` can
 * contain partial frames; we buffer until `\n\n`).
 */
export async function collectSSE(res: Response): Promise<SSEFrame[]> {
  const body = res.body
  if (!body) return []
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const frames: SSEFrame[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    if (done) break

    while (true) {
      const idx = buf.indexOf('\n\n')
      if (idx === -1) break
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const frame = parseFrame(raw)
      if (frame) frames.push(frame)
    }
  }
  // Flush any tail.
  buf += decoder.decode()
  if (buf.trim().length) {
    const tail = buf.split('\n\n').filter(Boolean)
    for (const raw of tail) {
      const frame = parseFrame(raw)
      if (frame) frames.push(frame)
    }
  }
  return frames
}

function parseFrame(raw: string): SSEFrame | null {
  let event = ''
  let dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (!event) return null
  const dataStr = dataLines.join('\n')
  let data: unknown
  try {
    data = dataStr ? JSON.parse(dataStr) : null
  } catch {
    data = dataStr
  }
  return { event, data }
}

export function eventNames(frames: SSEFrame[]): string[] {
  return frames.map((f) => f.event)
}
