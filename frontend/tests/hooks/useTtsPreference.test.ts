import { describe, expect, test, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTtsPreference } from '../../src/hooks/useTtsPreference'

beforeEach(() => {
  localStorage.clear()
})

describe('useTtsPreference', () => {
  test('defaults to off when nothing is persisted', () => {
    const { result } = renderHook(() => useTtsPreference())
    expect(result.current.ttsOn).toBe(false)
  })

  test('reads "1" from localStorage on mount', () => {
    localStorage.setItem('rx-tts-on', '1')
    const { result } = renderHook(() => useTtsPreference())
    expect(result.current.ttsOn).toBe(true)
  })

  test('toggle() flips state and writes to localStorage', () => {
    const { result } = renderHook(() => useTtsPreference())
    expect(result.current.ttsOn).toBe(false)

    act(() => result.current.toggle())
    expect(result.current.ttsOn).toBe(true)
    expect(localStorage.getItem('rx-tts-on')).toBe('1')

    act(() => result.current.toggle())
    expect(result.current.ttsOn).toBe(false)
    expect(localStorage.getItem('rx-tts-on')).toBe('0')
  })

  test('setTtsOn(true) persists', () => {
    const { result } = renderHook(() => useTtsPreference())
    act(() => result.current.setTtsOn(true))
    expect(result.current.ttsOn).toBe(true)
    expect(localStorage.getItem('rx-tts-on')).toBe('1')
  })

  test('persists across mounts', () => {
    const first = renderHook(() => useTtsPreference())
    act(() => first.result.current.setTtsOn(true))
    first.unmount()

    const second = renderHook(() => useTtsPreference())
    expect(second.result.current.ttsOn).toBe(true)
  })
})
