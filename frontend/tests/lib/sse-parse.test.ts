import { describe, expect, test } from 'vitest'
import { parseSSE, type SSEFrame } from '../../src/lib/sse-parse'

function streamFromString(text: string, chunkSize = text.length): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const slice = bytes.slice(offset, offset + chunkSize)
      offset += chunkSize
      controller.enqueue(slice)
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SSEFrame[]> {
  const out: SSEFrame[] = []
  for await (const frame of parseSSE(stream)) {
    out.push(frame)
  }
  return out
}

describe('parseSSE', () => {
  test('parses a single complete frame terminated by \\n\\n', async () => {
    const stream = streamFromString('event: text-delta\ndata: {"delta":"hi"}\n\n')
    const frames = await collect(stream)
    expect(frames).toEqual([{ event: 'text-delta', data: '{"delta":"hi"}' }])
  })

  test('parses two consecutive frames in a single chunk', async () => {
    const wire =
      'event: start\ndata: {"messageId":"01J"}\n\n' +
      'event: text-delta\ndata: {"delta":"a"}\n\n'
    const frames = await collect(streamFromString(wire))
    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual({ event: 'start', data: '{"messageId":"01J"}' })
    expect(frames[1]).toEqual({ event: 'text-delta', data: '{"delta":"a"}' })
  })

  test('joins multi-line data field with \\n', async () => {
    const wire = 'event: text-delta\ndata: line1\ndata: line2\ndata: line3\n\n'
    const frames = await collect(streamFromString(wire))
    expect(frames).toEqual([{ event: 'text-delta', data: 'line1\nline2\nline3' }])
  })

  test('flushes a final frame with no trailing blank line (EOF)', async () => {
    const wire = 'event: metadata\ndata: {"latencyMs":42}'
    const frames = await collect(streamFromString(wire))
    expect(frames).toEqual([{ event: 'metadata', data: '{"latencyMs":42}' }])
  })

  test('ignores comment lines starting with ":" per SSE spec', async () => {
    const wire = ': keep-alive\nevent: step\ndata: {"index":0}\n\n'
    const frames = await collect(streamFromString(wire))
    expect(frames).toEqual([{ event: 'step', data: '{"index":0}' }])
  })

  test('reassembles frames split across many small chunks', async () => {
    const wire =
      'event: start\ndata: {"messageId":"01J"}\n\n' +
      'event: text-delta\ndata: {"delta":"hello"}\n\n' +
      'event: metadata\ndata: {"latencyMs":42}\n\n'
    const frames = await collect(streamFromString(wire, 3))
    expect(frames).toHaveLength(3)
    expect(frames.map((f) => f.event)).toEqual(['start', 'text-delta', 'metadata'])
  })

  test('handles \\r\\n line endings', async () => {
    const wire = 'event: text-delta\r\ndata: {"delta":"a"}\r\n\r\n'
    const frames = await collect(streamFromString(wire))
    expect(frames).toEqual([{ event: 'text-delta', data: '{"delta":"a"}' }])
  })

  test('skips frames with no data field (heartbeats)', async () => {
    const wire = 'event: text-delta\ndata: {"delta":"a"}\n\n: heartbeat\n\n'
    const frames = await collect(streamFromString(wire))
    expect(frames).toEqual([{ event: 'text-delta', data: '{"delta":"a"}' }])
  })

  test('defaults event to "message" when none specified (SSE spec)', async () => {
    const wire = 'data: {"hello":"world"}\n\n'
    const frames = await collect(streamFromString(wire))
    expect(frames).toEqual([{ event: 'message', data: '{"hello":"world"}' }])
  })

  test('strips a single leading space from data values per SSE spec', async () => {
    const wire = 'event: e\ndata:no-space\ndata: with-space\n\n'
    const frames = await collect(streamFromString(wire))
    expect(frames).toEqual([{ event: 'e', data: 'no-space\nwith-space' }])
  })
})
