import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// Spec §2.4 — content-parts JSON shape (Vercel AI SDK ModelMessage parts)
export type ToolResultOutput =
  | { type: 'json'; value: unknown }
  | { type: 'text'; value: string }
  | { type: 'error-text'; value: string }
  | { type: 'error-json'; value: unknown }
  | {
      type: 'content'
      value: Array<
        | { type: 'text'; text: string }
        | { type: 'media'; data: string; mediaType: string }
      >
    }

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | {
      type: 'tool-result'
      toolCallId: string
      toolName: string
      output: ToolResultOutput
    }

export type Role = 'user' | 'assistant' | 'tool'

// ────────────────────────────────────────────────────────────────────
// conversations
// ────────────────────────────────────────────────────────────────────
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// ────────────────────────────────────────────────────────────────────
// messages — JSON content-parts blob (Step 0.5 #1 / #2)
// ────────────────────────────────────────────────────────────────────
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'tool'] }).notNull(),
    content: text('content', { mode: 'json' })
      .$type<ContentPart[] | string>()
      .notNull(),
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    // Step 0.5 #3 — UNIQUE prevents position races; deleteAndRenumber uses two-pass shift.
    uniqueIndex('messages_conv_pos_uq').on(t.conversationId, t.position),
    index('messages_conv_created_idx').on(t.conversationId, t.createdAt),
    // Step 0.5 #1 — explicit DB-level enforcement of role enum.
    check(
      'messages_role_chk',
      sql`${t.role} IN ('user', 'assistant', 'tool')`,
    ),
  ],
)

// ────────────────────────────────────────────────────────────────────
// usage — one row per assistant turn (Step 0.5 #4)
// ────────────────────────────────────────────────────────────────────
export const usage = sqliteTable('usage', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .unique()
    .references(() => messages.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheCreateTokens: integer('cache_create_tokens').notNull().default(0),
  latencyMs: integer('latency_ms').notNull(),
  costUsd: real('cost_usd').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type Conversation = typeof conversations.$inferSelect
export type Message = typeof messages.$inferSelect
export type Usage = typeof usage.$inferSelect
