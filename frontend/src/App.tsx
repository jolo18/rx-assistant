import { ThemeToggle } from './components/ThemeToggle'
import { useTheme } from './hooks/useTheme'
import { ComponentGallery } from './pages/ComponentGallery'

function showGallery(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof window === 'undefined') return false
  const { pathname, search } = window.location
  return pathname.startsWith('/__components') || /[?&]gallery=1\b/.test(search)
}

function App() {
  useTheme()

  return (
    <>
      <ThemeToggle />
      {showGallery() ? (
        <ComponentGallery />
      ) : (
        <div className="rx-root" />
      )}
    </>
  )
}

export default App
