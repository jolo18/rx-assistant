import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  getConversation,
  type ConversationDetail,
} from '../lib/api'

export type UseConversationResult = {
  conversation: ConversationDetail | null
  loading: boolean
  error: ApiError | null
  invalidate: () => Promise<void>
}

export function useConversation(id: string | undefined): UseConversationResult {
  const [conversation, setConversation] = useState<ConversationDetail | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(id))
  const [error, setError] = useState<ApiError | null>(null)
  const aliveRef = useRef(true)

  const refresh = useCallback(async () => {
    if (!id) {
      setConversation(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    try {
      const detail = await getConversation(id)
      if (aliveRef.current) {
        setConversation(detail)
        setError(null)
      }
    } catch (err) {
      if (aliveRef.current) {
        setError(err instanceof ApiError ? err : new ApiError('INTERNAL', String(err), 0))
        setConversation(null)
      }
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    return () => {
      aliveRef.current = false
    }
  }, [refresh])

  return { conversation, loading, error, invalidate: refresh }
}
