import { ThemeToggle } from './components/ThemeToggle'
import { useTheme } from './hooks/useTheme'

function App() {
  useTheme()

  return (
    <>
      <ThemeToggle />
      <div className="rx-root" />
    </>
  )
}

export default App
