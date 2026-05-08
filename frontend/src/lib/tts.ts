/**
 * Web Speech Synthesis facade — thin pure functions over `window.speechSynthesis`.
 * Provider-neutral on intent (per `feedback_avoid_provider_lockin`); if a future
 * phase swaps to a server-side TTS this is the only file the hook touches.
 *
 * Chunking: Chrome has a known ~15s utterance cut-off bug. Long answers are
 * split on sentence boundaries (or hard-cut at MAX_CHUNK_CHARS) and queued
 * via the consumer hook's onend → speak(next) chain.
 */

export const MAX_CHUNK_CHARS = 500

export type TtsSynthesisLike = {
  speak: (utt: SpeechSynthesisUtterance) => void
  cancel: () => void
  pause: () => void
  resume: () => void
  speaking: boolean
  paused: boolean
}

export function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined'
}

export function getSynthesis(): TtsSynthesisLike | null {
  if (!isSupported()) return null
  return window.speechSynthesis
}

/**
 * Split `text` into chunks ≤ MAX_CHUNK_CHARS, preferring sentence-end
 * boundaries (`. `, `! `, `? `) and falling back to whitespace, then a hard
 * cut. Returns the chunks in spoken order.
 */
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  if (trimmed.length <= maxChars) return [trimmed]

  const chunks: string[] = []
  let remaining = trimmed
  while (remaining.length > maxChars) {
    let cut = findSplit(remaining, maxChars)
    if (cut <= 0) cut = maxChars
    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

function findSplit(s: string, hardLimit: number): number {
  // Try the latest sentence-end inside the first `hardLimit` chars.
  for (const sep of ['. ', '! ', '? ', '\n\n', '\n']) {
    const idx = s.lastIndexOf(sep, hardLimit)
    if (idx > Math.floor(hardLimit / 2)) return idx + sep.length
  }
  // Fall back to the latest whitespace inside the limit.
  const wsIdx = s.lastIndexOf(' ', hardLimit)
  if (wsIdx > Math.floor(hardLimit / 2)) return wsIdx + 1
  return hardLimit
}

export type CreateUtteranceOptions = {
  lang?: string
  rate?: number
  pitch?: number
  volume?: number
  voice?: SpeechSynthesisVoice | null
}

export function createUtterance(text: string, opts: CreateUtteranceOptions = {}): SpeechSynthesisUtterance {
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = opts.lang ?? 'en-US'
  if (opts.rate !== undefined) utt.rate = opts.rate
  if (opts.pitch !== undefined) utt.pitch = opts.pitch
  if (opts.volume !== undefined) utt.volume = opts.volume
  if (opts.voice) utt.voice = opts.voice
  return utt
}
