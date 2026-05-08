import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Composer } from '../components/Composer'
import { MessageList } from '../components/MessageList'
import { MobileTop } from '../components/MobileTop'
import { Sidebar } from '../components/Sidebar'
import { useChatStreamContext } from '../hooks/chatStreamContext'
import { useConversations } from '../hooks/useConversations'

const MOBILE_QUERY = '(max-width: 720px)'

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(MOBILE_QUERY).matches
}

export function ChatPage() {
  const { id: routeConversationId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { conversations, loading, error, deleteConversation } = useConversations()
  const chat = useChatStreamContext()

  const [draft, setDraft] = useState('')
  const [pendingUser, setPendingUser] = useState<{ id: string; text: string } | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => isMobileViewport())

  // Mid-stream route push: as soon as `start.conversationId` arrives on a
  // brand-new conversation, swap the URL so the page is shareable. The
  // ChatStreamProvider sits above <Routes>, so this navigate doesn't
  // unmount us or clobber the in-flight stream.
  useEffect(() => {
    if (chat.state.phase !== 'streaming' && chat.state.phase !== 'done') return
    const incoming = chat.state.assistant.conversationId
    if (incoming && incoming !== routeConversationId) {
      navigate(`/c/${incoming}`, { replace: true })
    }
  }, [chat.state, routeConversationId, navigate])

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarCollapsed(true)
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  function handleSubmit(text: string) {
    const { tempUserMessageId } = chat.send(text)
    setPendingUser({ id: tempUserMessageId, text })
    setDraft('')
  }

  function handleRetry() {
    if (!pendingUser) return
    chat.send(pendingUser.text)
  }

  return (
    <div className="rx-shell" style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        conversations={conversations}
        loading={loading}
        error={error}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        onNewChat={() => {
          navigate('/')
          if (isMobileViewport()) setSidebarCollapsed(true)
        }}
        onDelete={async (id) => {
          const result = await deleteConversation(id)
          if (result.ok && routeConversationId === id) {
            navigate('/')
          }
          return result
        }}
      />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
      >
        <MobileTop
          onOpenMenu={() => setSidebarCollapsed(false)}
          onNewChat={() => navigate('/')}
        />
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '32px 32px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxWidth: 760,
            margin: '0 auto',
            width: '100%',
          }}
        >
          <MessageList state={chat.state} pendingUser={pendingUser} onRetry={handleRetry} />
        </div>
        <div style={{ padding: '0 32px 32px', maxWidth: 760, margin: '0 auto', width: '100%' }}>
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={handleSubmit}
            phase={chat.state.phase}
          />
        </div>
      </main>
    </div>
  )
}
