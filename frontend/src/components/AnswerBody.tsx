/**
 * Markdown renderer for the assistant's text. While streaming, react-markdown
 * is comparatively expensive on every state change — the spec asks for a
 * ~50ms debounce during stream and an instant final reparse once settled, so
 * partial code fences / unclosed tags resolve cleanly.
 */

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

type AnswerBodyProps = {
  text: string
  /** Skip the debounce and reparse instantly once we hit a settled phase. */
  settled?: boolean
}

const STREAM_DEBOUNCE_MS = 50

export function AnswerBody({ text, settled = false }: AnswerBodyProps) {
  const [displayedText, setDisplayedText] = useState(text)

  useEffect(() => {
    if (settled) {
      setDisplayedText(text)
      return
    }
    const handle = setTimeout(() => setDisplayedText(text), STREAM_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [text, settled])

  return (
    <div className="rx-answer t-body-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {displayedText}
      </ReactMarkdown>
    </div>
  )
}
