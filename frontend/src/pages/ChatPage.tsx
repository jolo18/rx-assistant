import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AssistantMessage } from '../components/AssistantMessage'
import { Composer } from '../components/Composer'
import { LoadingSkeleton } from '../components/LoadingSkeleton'
import { MessageList } from '../components/MessageList'
import { MobileTop } from '../components/MobileTop'
import { Sidebar } from '../components/Sidebar'
import { UserMessage } from '../components/UserMessage'
import { useChatStreamContext } from '../hooks/chatStreamContext'
import { useConversation } from '../hooks/useConversation'
import { useConversations } from '../hooks/useConversations'
import { useTtsPreference } from '../hooks/useTtsPreference'
import { deleteMessage } from '../lib/api'
import { groupIntoTurns, type Turn } from '../lib/turns'

const MOBILE_QUERY = '(max-width: 720px)'

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(MOBILE_QUERY).matches
}

export function ChatPage() {
  const { id: routeConversationId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    invalidate: invalidateConversations,
    deleteConversation: deleteConversationApi,
  } = useConversations()
  const { conversation, loading: hydratingHistory, invalidate: invalidateHistory } =
    useConversation(routeConversationId)
  const chat = useChatStreamContext()

  const [draft, setDraft] = useState('')
  const [pendingUser, setPendingUser] = useState<{ id: string; text: string } | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => isMobileViewport())
  const [isMobile, setIsMobile] = useState(() => isMobileViewport())
  const { ttsOn, toggle: toggleTts } = useTtsPreference()

  // Drop the optimistic bubble when the user navigates to a different
  // conversation, so we don't render a previous conversation's pending
  // message on top of the new conversation's history.
  useEffect(() => {
    setPendingUser(null)
    setDraft('')
  }, [routeConversationId])

  const turns = useMemo<Turn[]>(
    () => (conversation ? groupIntoTurns(conversation.messages) : []),
    [conversation],
  )

  // The id (or temp id) of the user message that anchors the *live* turn — so
  // we don't double-render it as both a history row + the optimistic bubble
  // once invalidate brings the persisted version in.
  const liveUserId =
    chat.state.phase === 'streaming' || chat.state.phase === 'done'
      ? chat.state.assistant.userMessageId
      : undefined

  // Mid-stream route push. Reading the canonical conversationId out of the
  // state union here means the effect only fires when *that* value changes —
  // not on every text-delta dispatch (which would update chat.state's
  // identity without changing the conversationId).
  const incomingConversationId =
    chat.state.phase === 'streaming' || chat.state.phase === 'done'
      ? chat.state.assistant.conversationId
      : undefined

  useEffect(() => {
    if (incomingConversationId && incomingConversationId !== routeConversationId) {
      navigate(`/c/${incomingConversationId}`, { replace: true })
    }
  }, [incomingConversationId, routeConversationId, navigate])

  // Once the stream settles, invalidate history so the just-completed turn
  // becomes part of the persisted view (replaces the live MessageList branch
  // for the next render). Don't clear pendingUser yet — wait until history
  // actually contains the user-message id, otherwise the optimistic bubble
  // disappears in the gap between settle and reload.
  useEffect(() => {
    if (chat.state.phase !== 'done') return
    void invalidateHistory()
    void invalidateConversations()
  }, [chat.state.phase, invalidateHistory, invalidateConversations])

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
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

  async function handleDeleteTurn(userMessageId: string) {
    try {
      await deleteMessage(userMessageId)
    } catch {
      // Surfaced via the conversation reload on next invalidate; for now we
      // just refresh and let the row reappear if delete failed.
    }
    await invalidateHistory()
    await invalidateConversations()
  }

  // Only show the live MessageList branch when there's something live to show
  // (current send in flight, error pill, or a brand-new conversation we
  // haven't yet hydrated). After invalidate, history owns the just-finished
  // turn and we don't double-render it.
  const liveTurnAlreadyInHistory = Boolean(
    liveUserId && turns.some((t) => t.user.id === liveUserId),
  )
  const showLiveBranch =
    chat.state.phase !== 'idle' && !liveTurnAlreadyInHistory

  // Clear the optimistic bubble only after history has caught up — otherwise
  // the bubble vanishes between the metadata frame and the next /api/
  // conversations/:id round-trip.
  useEffect(() => {
    if (liveTurnAlreadyInHistory) setPendingUser(null)
  }, [liveTurnAlreadyInHistory])

  const showMobileBackdrop = isMobile && !sidebarCollapsed

  return (
    <div
      className={'rx-shell rx-app' + (isMobile ? ' rx-app--mobile' : '')}
      style={{ display: 'flex', minHeight: '100vh' }}
    >
      {showMobileBackdrop && (
        <div
          className="rx-sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}
      <Sidebar
        conversations={conversations}
        loading={conversationsLoading}
        error={conversationsError}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        onNewChat={() => {
          navigate('/')
          if (isMobileViewport()) setSidebarCollapsed(true)
        }}
        onDelete={async (id) => {
          const result = await deleteConversationApi(id)
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
          minWidth: 0,
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
            overflowX: 'hidden',
            padding: '32px 32px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxWidth: 760,
            margin: '0 auto',
            width: '100%',
            minWidth: 0,
          }}
        >
          {hydratingHistory && <LoadingSkeleton />}

          {!hydratingHistory &&
            turns.map((turn) => (
              <div
                key={turn.user.id}
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                <UserMessage text={turn.user.text} />
                {turn.assistant && (
                  <AssistantMessage
                    assistant={turn.assistant}
                    phase="done"
                    onDeleteTurn={() => handleDeleteTurn(turn.user.id)}
                    ttsOn={ttsOn}
                    /* Historical turns: don't auto-play retroactively when
                     * the user toggles TTS on while reading old messages.
                     * Manual play button only. Live MessageList still
                     * auto-plays the just-completed turn. */
                    ttsAutoPlay={false}
                  />
                )}
              </div>
            ))}

          {showLiveBranch && (
            <MessageList
              state={chat.state}
              pendingUser={pendingUser}
              onRetry={handleRetry}
              ttsOn={ttsOn}
            />
          )}
        </div>
        <div style={{ padding: '0 32px 32px', maxWidth: 760, margin: '0 auto', width: '100%' }}>
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={handleSubmit}
            phase={chat.state.phase}
            ttsOn={ttsOn}
            onToggleTts={toggleTts}
          />
        </div>
      </main>
    </div>
  )
}
