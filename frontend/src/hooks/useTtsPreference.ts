/**
 * Persists the user's TTS-on preference across reloads — same pattern as
 * useTheme. Default is `false` (TTS off) so a fresh user doesn't get
 * surprise audio on their first stream.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'rx-tts-on'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return saved === '1'
}

export function useTtsPreference(): {
  ttsOn: boolean
  toggle: () => void
  setTtsOn: (next: boolean) => void
} {
  const [ttsOn, setTtsOn] = useState<boolean>(readInitial)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, ttsOn ? '1' : '0')
  }, [ttsOn])

  const toggle = useCallback(() => setTtsOn((v) => !v), [])

  return { ttsOn, toggle, setTtsOn }
}
