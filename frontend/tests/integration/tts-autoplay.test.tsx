/**
 * Slice 21 integration: with `ttsOn` true the live MessageList auto-plays the
 * just-completed assistant turn via Web Speech Synthesis. With `ttsOn` false
 * no utterance fires.
 *
 * Mocks the SSE backend via MSW (same handler shape as slice 15's
 * live-stream tests) and stubs `window.speechSynthesis` so we can assert
 * `speak()` was (or wasn't) called.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../helpers/msw-server'
import { buildSSEStream, SSE_HEADERS, type SSEEntry } from '../helpers/sse'
import { ChatStreamProvider } from '../../src/hooks/chatStreamContext'
import { ChatPage } from '../../src/pages/ChatPage'

const CHAT_URL = 'http://localhost:3000/api/chat'

const idStart = {
  messageId: '01ASSIST',
  userMessageId: '01USER',
  conversationId: '01CONV',
  model: 'anthropic/claude-sonnet-4.6',
}

function happyStream(): ReadonlyArray<SSEEntry> {
  return [
    { event: 'start', data: idStart },
    { event: 'text-delta', data: { delta: 'Ibuprofen is an NSAID.' } },
    {
      event: 'metadata',
      data: {
        messageId: '01ASSIST',
        model: 'sonnet-4.6',
        inputTokens: 12,
        outputTokens: 8,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        latencyMs: 100,
        costUsd: 0.0001,
      },
    },
  ]
}

class MockUtterance {
  text: string
  lang = 'en-US'
  voice: SpeechSynthesisVoice | null = null
  volume = 1
  rate = 1
  pitch = 1
  onstart: ((e: Event) => void) | null = null
  onend: ((e: Event) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onboundary: ((e: { name: string; charIndex: number; charLength: number }) => void) | null = null
  onpause: ((e: Event) => void) | null = null
  onresume: ((e: Event) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

function installSynthMock() {
  const speak = vi.fn()
  const cancel = vi.fn()
  const synth = { speak, cancel, pause: vi.fn(), resume: vi.fn(), getVoices: () => [], speaking: false, paused: false, pending: false }
  Object.defineProperty(window, 'speechSynthesis', {
    value: synth,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    value: MockUtterance,
    writable: true,
    configurable: true,
  })
  return { synth, speak, cancel }
}

function removeSynthMock() {
  // @ts-expect-error - test cleanup
  delete window.speechSynthesis
  // @ts-expect-error - test cleanup
  delete window.SpeechSynthesisUtterance
}

function mountAt(path: string) {
  server.use(
    http.get('http://localhost:3000/api/conversations', () => HttpResponse.json([])),
    http.get('http://localhost:3000/api/conversations/:id', () =>
      HttpResponse.json({
        id: '01CONV',
        title: null,
        createdAt: 'x',
        updatedAt: 'x',
        messages: [],
      }),
    ),
  )
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChatStreamProvider>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/c/:id" element={<ChatPage />} />
        </Routes>
      </ChatStreamProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  removeSynthMock()
  localStorage.clear()
})

afterEach(() => {
  removeSynthMock()
})

describe('TTS auto-play on settle (slice 21)', () => {
  test('with ttsOn=true (persisted), settling a stream calls speechSynthesis.speak', async () => {
    localStorage.setItem('rx-tts-on', '1')
    const { speak } = installSynthMock()
    server.use(
      http.post(CHAT_URL, () =>
        new HttpResponse(buildSSEStream(happyStream()), { headers: SSE_HEADERS }),
      ),
    )

    const user = userEvent.setup()
    mountAt('/')

    const ta = await screen.findByPlaceholderText(/medication or a symptom/i)
    await user.type(ta, 'What is ibuprofen?')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => expect(speak).toHaveBeenCalled(), { timeout: 2000 })
    const utt = (speak.mock.calls[0]![0] as MockUtterance)
    expect(utt.text).toContain('Ibuprofen is an NSAID')
  })

  test('with ttsOn=false (default), settling a stream does NOT call speak', async () => {
    const { speak } = installSynthMock()
    server.use(
      http.post(CHAT_URL, () =>
        new HttpResponse(buildSSEStream(happyStream()), { headers: SSE_HEADERS }),
      ),
    )

    const user = userEvent.setup()
    mountAt('/')

    const ta = await screen.findByPlaceholderText(/medication or a symptom/i)
    await user.type(ta, 'foo')
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    // Wait until the answer text appears, then assert speak was never called.
    await waitFor(() => expect(screen.getByText(/Ibuprofen is an NSAID/)).toBeInTheDocument(), {
      timeout: 2000,
    })
    expect(speak).not.toHaveBeenCalled()
  })

  test('Composer toggle persists ttsOn across the rest of this test only via localStorage', async () => {
    // Fresh mount, default off.
    expect(localStorage.getItem('rx-tts-on')).toBeNull()
    installSynthMock()
    server.use(
      http.post(CHAT_URL, () =>
        new HttpResponse(buildSSEStream(happyStream()), { headers: SSE_HEADERS }),
      ),
    )

    const user = userEvent.setup()
    mountAt('/')

    const tts = await screen.findByRole('button', { name: /enable spoken replies/i })
    await user.click(tts)

    expect(localStorage.getItem('rx-tts-on')).toBe('1')
    expect(screen.getByRole('button', { name: /disable spoken replies/i })).toBeInTheDocument()
  })
})
