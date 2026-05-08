# Rx Assistant — frontend

React 19 + Vite + TypeScript + react-router-dom v7. Consumes the SSE stream from the backend's `POST /api/chat` over `fetch + ReadableStream` (EventSource doesn't support POST).

See the top-level [`README.md`](../README.md) for project context, demo script, and architecture.

## Commands

```sh
bun install         # one-time
bun run dev         # vite — http://localhost:5173 (proxies /api → :8787)
bun run test        # vitest, 175 tests
bun run test:watch  # vitest watch mode
bun run typecheck   # tsc -b --noEmit
bun run build       # production build
bun run preview     # preview the production build
```

## Layout

```
src/
├── components/          # 13 leaf components + icons
│   ├── icons.tsx        # 28-icon set ported from design/project/icons.jsx
│   ├── AssistantMessage.tsx     # composes Reasoning, ToolCalls, Answer, Footer
│   ├── AnswerBody.tsx           # react-markdown + remark-gfm + rehype-highlight
│   ├── ToolCall.tsx + FormattedToolOutput.tsx
│   ├── Composer.tsx     # text-only; voice disabled-with-tooltip until Phase 3
│   ├── Sidebar.tsx + MobileTop.tsx
│   └── …                # Caret, ErrorPill, MessageFooter, ReasoningPanel, etc.
├── hooks/
│   ├── useChatStream.ts         # state machine over the §3.2 wire union
│   ├── chatStreamContext.tsx    # lifts state above <Routes> for the mid-stream push
│   ├── useConversations.ts      # sidebar list
│   ├── useConversation.ts       # detail hydration
│   └── useTheme.ts              # localStorage rx-theme + prefers-color-scheme
├── lib/
│   ├── chat-events.ts           # ChatEvent discriminated union, ErrorCode, ContentPart
│   ├── sse-parse.ts             # async generator over ReadableStream<Uint8Array>
│   ├── api.ts                   # fetch wrappers; throws ApiError on §3.4 envelopes
│   └── turns.ts                 # history → renderable turns (groupIntoTurns)
├── pages/
│   ├── ChatPage.tsx
│   └── ComponentGallery.tsx     # dev-only — /__components or ?gallery=1
├── styles/
│   ├── tokens.css               # design tokens, light + dark variants
│   ├── components.css           # ported from design/project/components.css
│   └── reset.css                # tiny box-sizing/typography reset
├── App.tsx                      # BrowserRouter + ChatStreamProvider
└── main.tsx
tests/
├── components/                  # snapshot + a11y per component
├── hooks/                       # useChatStream against MSW-mocked SSE
├── integration/                 # live-stream + reload-history round-trips
├── lib/                         # sse-parse, chat-events, turns, api
├── pages/                       # ChatPage hydration + delete flow
└── helpers/                     # msw-server, sse stream builder
```

## Component gallery (dev only)

Visit `http://localhost:5173/__components` while the dev server is running to eyeball every component branch in isolation — including all 7 `<ErrorPill>` codes and the new `<FormattedToolOutput>` empty / 404 / error branches.
