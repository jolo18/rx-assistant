/**
 * Composes the chat transcript: optimistic user bubble + the live assistant
 * turn from useChatStream. Slice 16 (history hydration) extends this with
 * persisted turns from groupIntoTurns above the live one.
 */

import type { ChatStreamState } from '../hooks/useChatStream'
import { AssistantMessage } from './AssistantMessage'
import { FirstTokenIndicator } from './FirstTokenIndicator'
import { UserMessage } from './UserMessage'

type MessageListProps = {
  state: ChatStreamState
  pendingUser: { id: string; text: string } | null
  onRetry?: () => void
  /** When true, settled assistant messages auto-play via Web Speech Synthesis. */
  ttsOn?: boolean
}

export function MessageList({ state, pendingUser, onRetry, ttsOn = false }: MessageListProps) {
  const showFirstToken =
    state.phase === 'submitting' ||
    (state.phase === 'streaming' && state.assistant.text === '' && state.assistant.toolCalls.length === 0)

  return (
    <>
      {pendingUser && <UserMessage text={pendingUser.text} />}

      {state.phase === 'streaming' && (
        <AssistantMessage assistant={state.assistant} phase="streaming" liveCapped />
      )}

      {state.phase === 'done' && (
        <AssistantMessage assistant={state.assistant} phase="done" liveCapped ttsOn={ttsOn} />
      )}

      {state.phase === 'error' && (
        // No assistant shape exists when error fires before `start` (network /
        // pre-stream failures); fall back to a bare ErrorPill via a synthesized
        // empty assistant so the message column gets the full chrome.
        <AssistantMessage
          assistant={emptyAssistant()}
          phase="error"
          errorCode={state.code}
          errorMessage={state.message}
          onRetry={onRetry}
        />
      )}

      {showFirstToken && <FirstTokenIndicator />}
    </>
  )
}

function emptyAssistant(): import('../hooks/useChatStream').AssistantMessageInProgress {
  return {
    messageId: '',
    userMessageId: '',
    conversationId: '',
    model: '',
    reasoning: { open: false, text: '', done: false },
    toolCalls: [],
    text: '',
    steps: [],
  }
}
