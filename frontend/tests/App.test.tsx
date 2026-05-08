import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'

describe('App boot smoke', () => {
  test('renders without throwing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  test('mounts in light theme by default', () => {
    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  test('renders the theme toggle control', () => {
    render(<App />)
    const toggle = screen.getByRole('button', { name: /theme/i })
    expect(toggle).toBeInTheDocument()
  })

  test('clicking the theme toggle flips data-theme to dark', async () => {
    const user = userEvent.setup()
    render(<App />)
    const toggle = screen.getByRole('button', { name: /theme/i })
    await user.click(toggle)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
