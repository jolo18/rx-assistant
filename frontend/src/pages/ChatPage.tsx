import { useNavigate } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { useConversations } from '../hooks/useConversations'

export function ChatPage() {
  const { conversations, loading, error, deleteConversation } = useConversations()
  const navigate = useNavigate()

  return (
    <div className="rx-shell" style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        conversations={conversations}
        loading={loading}
        error={error}
        onNewChat={() => navigate('/')}
        onDelete={async (id) => {
          const result = await deleteConversation(id)
          // Navigate away if we just deleted the conversation we were viewing.
          if (result.ok && window.location.pathname === `/c/${id}`) {
            navigate('/')
          }
          return result
        }}
      />
      <main style={{ flex: 1, padding: 24 }}>
        {/* Slice 14 (Composer) + Slice 15 (MessageList) fill this region. */}
        <div className="rx-root" />
      </main>
    </div>
  )
}
