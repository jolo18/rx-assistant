/**
 * SSE-stream test helpers for MSW handlers. Build a streaming Response body
 * that emits one frame per pushed entry, optionally with delays between frames
 * so reducer tests can assert intermediate states.
 */

export type SSEEntry = {
  event: string
  data: unknown
  /** Wait this many ms *after* writing this frame before writing the next one. */
  delayMsAfter?: number
}

/**
 * Convert a list of SSE entries into a `ReadableStream<Uint8Array>` that emits
 * proper `event:` / `data:` / `\n\n` framing. JSON-encodes `data` for objects.
 */
export function buildSSEStream(entries: ReadonlyArray<SSEEntry>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const entry of entries) {
        const payload =
          typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data)
        const frame = `event: ${entry.event}\ndata: ${payload}\n\n`
        controller.enqueue(encoder.encode(frame))
        if (entry.delayMsAfter && entry.delayMsAfter > 0) {
          await sleep(entry.delayMsAfter)
        }
      }
      controller.close()
    },
  })
}

/**
 * Build a stream that never completes a frame — used to simulate a hung
 * upstream that aborts on the consumer's AbortController. Resolves after
 * `holdMs` then closes empty.
 */
export function buildHangingStream(holdMs = 5_000): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      await sleep(holdMs)
      controller.close()
    },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const
