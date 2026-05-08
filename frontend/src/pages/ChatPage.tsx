import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Composer } from '../components/Composer'
import { FirstTokenIndicator } from '../components/FirstTokenIndicator'
import { MobileTop } from '../components/MobileTop'
import { Sidebar } from '../components/Sidebar'
import { UserMessage } from '../components/UserMessage'
import { useChatStream } from '../hooks/useChatStream'
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
  const chat = useChatStream({ conversationId: routeConversationId })

  const [draft, setDraft] = useState('')
  const [pendingUser, setPendingUser] = useState<{ id: string; text: string } | null>(null)
  // sidebar collapsed semantics:
  //   desktop  → 56px icon strip
  //   mobile   → fully hidden (MobileTop is the entry point)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => isMobileViewport())

  // Re-collapse the sidebar whenever the viewport flips into mobile width so
  // the overlay sheet doesn't hang around after a resize.
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

  const showFirstToken =
    chat.state.phase === 'submitting' ||
    (chat.state.phase === 'streaming' && chat.state.assistant.text === '')

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
          {pendingUser && <UserMessage text={pendingUser.text} />}
          {showFirstToken && <FirstTokenIndicator />}
          {/* Slice 15 fills the assistant rendering here. */}
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
