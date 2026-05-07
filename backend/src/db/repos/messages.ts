import { and, asc, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { newId } from '../../lib/ids.ts'
import { httpError } from '../../lib/errors.ts'
import { noopLogger, type Logger } from '../../lib/logger.ts'
import { conversations, messages, type ContentPart, type Message, type Role } from '../schema.ts'

export type AppendMessageInput = {
  conversationId: string
  role: Role
  content: ContentPart[] | string
  /** Optional pre-allocated id (e.g. for the stream's `start` messageId). */
  id?: string
}

export type RepoOpts = { logger?: Logger }

export function makeMessagesRepo(db: DB, opts: RepoOpts = {}) {
  const log = opts.logger ?? noopLogger
  const base = { layer: 'repo' as const, table: 'messages' as const }
  const round = (n: number) => Math.round(n * 100) / 100

  function nextPosition(conversationId: string): number {
    const row = db
      .select({ max: sql<number | null>`MAX(${messages.position})` })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .get()
    const current = row?.max
    return current === null || current === undefined ? 0 : current + 1
  }

  return {
    append(input: AppendMessageInput): { id: string; position: number } {
      const t0 = performance.now()
      const id = input.id ?? newId()
      const now = Date.now()
      let position = 0

      db.transaction((tx) => {
        position = (() => {
          const row = tx
            .select({ max: sql<number | null>`MAX(${messages.position})` })
            .from(messages)
            .where(eq(messages.conversationId, input.conversationId))
            .get()
          const current = row?.max
          return current === null || current === undefined ? 0 : current + 1
        })()

        tx.insert(messages)
          .values({
            id,
            conversationId: input.conversationId,
            role: input.role,
            content: input.content,
            position,
            createdAt: now,
          })
          .run()

        tx.update(conversations)
          .set({ updatedAt: now })
          .where(eq(conversations.id, input.conversationId))
          .run()
      })

      log.debug(
        {
          ...base,
          op: 'append',
          durationMs: round(performance.now() - t0),
          role: input.role,
          position,
        },
        'repo.append',
      )
      return { id, position }
    },

    loadHistory(conversationId: string): Message[] {
      const t0 = performance.now()
      const rows = db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.position))
        .all()
      log.debug(
        {
          ...base,
          op: 'loadHistory',
          durationMs: round(performance.now() - t0),
          rowsAffected: rows.length,
        },
        'repo.loadHistory',
      )
      return rows
    },

    /**
     * Step 0.5 #3 — UNIQUE (conversation_id, position) means we can't simply
     * `UPDATE position = position - 1`; SQLite has no DEFERRABLE constraints.
     * Two-pass shift via negative offsets keeps the invariant intact.
     */
    deleteAndRenumber(id: string): void {
      const t0 = performance.now()
      const target = db
        .select({
          conversationId: messages.conversationId,
          position: messages.position,
        })
        .from(messages)
        .where(eq(messages.id, id))
        .get()

      if (!target) {
        log.debug(
          { ...base, op: 'deleteAndRenumber', durationMs: round(performance.now() - t0), found: false, id },
          'repo.deleteAndRenumber',
        )
        return
      }

      db.transaction((tx) => {
        // Pass 1: shift later rows to negative offsets.
        tx.update(messages)
          .set({ position: sql`-${messages.position}` })
          .where(
            and(
              eq(messages.conversationId, target.conversationId),
              gt(messages.position, target.position),
            ),
          )
          .run()

        // Delete the target.
        tx.delete(messages).where(eq(messages.id, id)).run()

        // Pass 2: shift back, closing the gap. position = -position - 1.
        tx.update(messages)
          .set({ position: sql`-${messages.position} - 1` })
          .where(
            and(
              eq(messages.conversationId, target.conversationId),
              lt(messages.position, 0),
            ),
          )
          .run()
      })
      log.debug(
        { ...base, op: 'deleteAndRenumber', durationMs: round(performance.now() - t0), found: true, id },
        'repo.deleteAndRenumber',
      )
    },

    /**
     * Step 0.6 §3 — DELETE /api/messages/:id only accepts user-message ids
     * and cascades through the rest of the turn (everything up to the next
     * user message, or end of conversation).
     */
    deleteUserTurn(userMessageId: string): void {
      const t0 = performance.now()
      const target = db
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          role: messages.role,
          position: messages.position,
        })
        .from(messages)
        .where(eq(messages.id, userMessageId))
        .get()

      if (!target) {
        throw httpError(404, 'NOT_FOUND', `message ${userMessageId} not found`)
      }
      if (target.role !== 'user') {
        throw httpError(
          400,
          'INVALID_TARGET',
          `DELETE /api/messages/:id only accepts user-message ids; got role=${target.role}`,
        )
      }

      // Find the next user message in the same conversation (if any).
      const nextUser = db
        .select({ position: messages.position })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, target.conversationId),
            eq(messages.role, 'user'),
            gt(messages.position, target.position),
          ),
        )
        .orderBy(asc(messages.position))
        .limit(1)
        .get()

      const upperBound = nextUser?.position ?? null
      const turnLength =
        upperBound === null ? Infinity : upperBound - target.position

      db.transaction((tx) => {
        // 1) Delete the entire turn slice [target.position, upperBound).
        if (upperBound === null) {
          tx.delete(messages)
            .where(
              and(
                eq(messages.conversationId, target.conversationId),
                gte(messages.position, target.position),
              ),
            )
            .run()
        } else {
          tx.delete(messages)
            .where(
              and(
                eq(messages.conversationId, target.conversationId),
                gte(messages.position, target.position),
                lt(messages.position, upperBound),
              ),
            )
            .run()
        }

        // 2) If there were rows after the deleted turn, renumber via two-pass.
        if (turnLength !== Infinity) {
          tx.update(messages)
            .set({ position: sql`-${messages.position}` })
            .where(
              and(
                eq(messages.conversationId, target.conversationId),
                gte(messages.position, upperBound!),
              ),
            )
            .run()
          tx.update(messages)
            .set({ position: sql`-${messages.position} - ${turnLength}` })
            .where(
              and(
                eq(messages.conversationId, target.conversationId),
                lt(messages.position, 0),
              ),
            )
            .run()
        }

        tx.update(conversations)
          .set({ updatedAt: Date.now() })
          .where(eq(conversations.id, target.conversationId))
          .run()
      })
      log.debug(
        {
          ...base,
          op: 'deleteUserTurn',
          durationMs: round(performance.now() - t0),
          turnLength: turnLength === Infinity ? null : turnLength,
        },
        'repo.deleteUserTurn',
      )
    },
  }
}

// Suppress unused-warning for `isNull` (kept for future repo extensions).
void isNull
