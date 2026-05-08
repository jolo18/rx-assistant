import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AudioPlayer } from '../../src/components/AudioPlayer'

describe('AudioPlayer', () => {
  test('compact variant renders a play/pause button + progress fill', () => {
    const { container } = render(<AudioPlayer variant="compact" playing progress={0.4} />)
    const root = container.querySelector('.rx-audio.rx-audio--compact')!
    expect(root).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
    const fill = container.querySelector('.rx-audio__fill') as HTMLElement
    expect(fill.style.width).toBe('40%')
  })

  test('paused state swaps to a play button', () => {
    render(<AudioPlayer variant="compact" playing={false} />)
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
  })

  test('progress is clamped to 0..1', () => {
    const { container } = render(<AudioPlayer variant="compact" playing progress={1.5} />)
    const fill = container.querySelector('.rx-audio__fill') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  test('clicking the play/pause button fires onPlayPause', async () => {
    const user = userEvent.setup()
    const onPlayPause = vi.fn()
    render(<AudioPlayer variant="compact" playing onPlayPause={onPlayPause} />)
    await user.click(screen.getByRole('button', { name: /pause/i }))
    expect(onPlayPause).toHaveBeenCalledTimes(1)
  })

  test('full variant renders read-only progress (no thumb, no scrub interaction)', () => {
    const { container } = render(<AudioPlayer variant="full" playing progress={0.25} />)
    expect(container.querySelector('.rx-audio--full')).toBeInTheDocument()
    // Web Speech Synthesis can't seek — no thumb, no scrub control.
    expect(container.querySelector('.rx-audio__thumb')).toBeNull()
    expect(container.querySelector('input[type="range"]')).toBeNull()
    // Progress fill still updates.
    const fill = container.querySelector('.rx-audio__fill') as HTMLElement
    expect(fill.style.width).toBe('25%')
  })

  test('a11y: root has role=group and accessible label', () => {
    const { container } = render(<AudioPlayer variant="compact" playing />)
    const root = container.querySelector('[role="group"]')!
    expect(root).toHaveAttribute('aria-label', expect.stringMatching(/spoken reply/i))
  })
})
