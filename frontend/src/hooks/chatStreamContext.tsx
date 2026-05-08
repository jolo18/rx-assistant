/**
 * Lifts the in-flight ChatStreamHandle above <Routes> so a mid-stream route
 * push from `/` to `/c/:newId` (when start.conversationId arrives) doesn't
 * unmount ChatPage and discard the stream. Both the no-conversation and
 * active-conversation routes consume the same handle.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useChatStream, type ChatStreamHandle } from './useChatStream'

const ChatStreamContext = createContext<ChatStreamHandle | null>(null)

const CHAT_PATH_RE = /^\/c\/([^/?#]+)/

function conversationIdFromPath(pathname: string): string | undefined {
  const match = CHAT_PATH_RE.exec(pathname)
  return match?.[1]
}

export function ChatStreamProvider({ children }: { children: ReactNode }) {
  // Live-derived from the URL so a mid-stream navigate(`/c/${newId}`) flows
  // back into the next send() body without remounting useChatStream.
  const { pathname } = useLocation()
  const conversationId = useMemo(() => conversationIdFromPath(pathname), [pathname])

  const handle = useChatStream({ conversationId })

  return <ChatStreamContext.Provider value={handle}>{children}</ChatStreamContext.Provider>
}

export function useChatStreamContext(): ChatStreamHandle {
  const ctx = useContext(ChatStreamContext)
  if (!ctx) {
    throw new Error('useChatStreamContext must be used inside <ChatStreamProvider>')
  }
  return ctx
}
