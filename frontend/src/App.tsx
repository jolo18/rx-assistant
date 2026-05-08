import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ThemeToggle } from './components/ThemeToggle'
import { useTheme } from './hooks/useTheme'
import { ChatPage } from './pages/ChatPage'
import { ComponentGallery } from './pages/ComponentGallery'

const galleryEnabled = import.meta.env.DEV

function App() {
  useTheme()

  return (
    <BrowserRouter>
      <ThemeToggle />
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/c/:id" element={<ChatPage />} />
        {galleryEnabled && (
          <Route path="/__components" element={<ComponentGallery />} />
        )}
      </Routes>
    </BrowserRouter>
  )
}

export default App
