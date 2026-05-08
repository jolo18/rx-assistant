import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { Sun, Moon, Send, Beaker, Stethoscope, ChevronDown, Alert, Check } from '../../src/components/icons'

describe('icons module', () => {
  test('renders SVG with currentColor stroke and aria-hidden', () => {
    const { container } = render(<Sun />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '18')
  })

  test('honors custom size prop', () => {
    const { container } = render(<Moon size={32} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('width', '32')
    expect(svg).toHaveAttribute('height', '32')
  })

  test('every named icon mounts without throwing', () => {
    for (const Ic of [Sun, Moon, Send, Beaker, Stethoscope, ChevronDown, Alert, Check]) {
      const { container, unmount } = render(<Ic />)
      expect(container.querySelector('svg')).toBeInTheDocument()
      unmount()
    }
  })
})
