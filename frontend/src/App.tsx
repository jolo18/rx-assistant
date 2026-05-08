import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ThemeToggle } from './components/ThemeToggle'
import { ChatStreamProvider } from './hooks/chatStreamContext'
import { useTheme } from './hooks/useTheme'
import { ChatPage } from './pages/ChatPage'
import { ComponentGallery } from './pages/ComponentGallery'

const galleryEnabled = import.meta.env.DEV

function App() {
  useTheme()

  return (
    <BrowserRouter>
      <ChatStreamProvider>
        <ThemeToggle />
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/c/:id" element={<ChatPage />} />
          {galleryEnabled && (
            <Route path="/__components" element={<ComponentGallery />} />
          )}
        </Routes>
      </ChatStreamProvider>
    </BrowserRouter>
  )
}

export default App
