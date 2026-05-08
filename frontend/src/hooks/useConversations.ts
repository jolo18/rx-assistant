import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  deleteConversation as apiDeleteConversation,
  listConversations,
  type ConversationSummary,
} from '../lib/api'

export type UseConversationsResult = {
  conversations: ConversationSummary[]
  loading: boolean
  error: ApiError | null
  invalidate: () => Promise<void>
  deleteConversation: (id: string) => Promise<{ ok: true } | { ok: false; error: ApiError }>
}

export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  // Track unmount so async fetches don't try to set state after the hook is gone.
  const aliveRef = useRef(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listConversations()
      if (aliveRef.current) {
        setConversations(list)
        setError(null)
      }
    } catch (err) {
      if (aliveRef.current) {
        setError(err instanceof ApiError ? err : new ApiError('INTERNAL', String(err), 0))
      }
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    return () => {
      aliveRef.current = false
    }
  }, [refresh])

  const deleteConversation = useCallback(
    async (id: string): Promise<{ ok: true } | { ok: false; error: ApiError }> => {
      // Optimistic remove so the row disappears instantly; refresh confirms.
      const prev = conversations
      setConversations((cs) => cs.filter((c) => c.id !== id))
      try {
        await apiDeleteConversation(id)
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : new ApiError('INTERNAL', String(err), 0)
        if (aliveRef.current) {
          setConversations(prev)
          setError(apiErr)
        }
        return { ok: false, error: apiErr }
      }
      await refresh()
      return { ok: true }
    },
    [conversations, refresh],
  )

  return {
    conversations,
    loading,
    error,
    invalidate: refresh,
    deleteConversation,
  }
}
