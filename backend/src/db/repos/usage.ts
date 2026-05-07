import { eq } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { newId } from '../../lib/ids.ts'
import { messages, usage, type Usage } from '../schema.ts'

export type RecordUsageInput = {
  messageId: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  latencyMs: number
  costUsd: number
}

export type ConversationUsage = {
  totals: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreateTokens: number
    costUsd: number
  }
  perMessage: Usage[]
}

export function makeUsageRepo(db: DB) {
  return {
    record(input: RecordUsageInput): { id: string } {
      const id = newId()
      db.insert(usage)
        .values({
          id,
          messageId: input.messageId,
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          cacheReadTokens: input.cacheReadTokens,
          cacheCreateTokens: input.cacheCreateTokens,
          latencyMs: input.latencyMs,
          costUsd: input.costUsd,
          createdAt: Date.now(),
        })
        .run()
      return { id }
    },

    byMessage(messageId: string): Usage | null {
      const rows = db
        .select()
        .from(usage)
        .where(eq(usage.messageId, messageId))
        .limit(1)
        .all()
      return rows[0] ?? null
    },

    forConversation(conversationId: string): ConversationUsage {
      const rows = db
        .select({ usage })
        .from(usage)
        .innerJoin(messages, eq(messages.id, usage.messageId))
        .where(eq(messages.conversationId, conversationId))
        .all()
      const perMessage = rows.map((r) => r.usage)
      const totals = perMessage.reduce(
        (acc, r) => ({
          inputTokens: acc.inputTokens + r.inputTokens,
          outputTokens: acc.outputTokens + r.outputTokens,
          cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
          cacheCreateTokens: acc.cacheCreateTokens + r.cacheCreateTokens,
          costUsd: acc.costUsd + r.costUsd,
        }),
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          costUsd: 0,
        },
      )
      return { totals, perMessage }
    },
  }
}
