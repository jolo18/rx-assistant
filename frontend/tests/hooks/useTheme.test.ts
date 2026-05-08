import { describe, expect, test, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTheme } from '../../src/hooks/useTheme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('useTheme', () => {
  test('defaults to light when no localStorage entry exists and system prefers light', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  test('reads persisted value from localStorage on mount', () => {
    localStorage.setItem('rx-theme', 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  test('toggle() flips theme and persists to localStorage', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')

    act(() => {
      result.current.toggle()
    })

    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('rx-theme')).toBe('dark')
  })

  test('toggle() round-trips back to light', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.toggle()
    })
    act(() => {
      result.current.toggle()
    })

    expect(result.current.theme).toBe('light')
    expect(localStorage.getItem('rx-theme')).toBe('light')
  })

  test('falls back to system preference when localStorage is empty', () => {
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })

    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: original,
    })
  })
})
