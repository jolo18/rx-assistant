import { desc, eq } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { newId } from '../../lib/ids.ts'
import { noopLogger, type Logger } from '../../lib/logger.ts'
import { conversations, type Conversation } from '../schema.ts'

export type CreateConversationInput = { title: string | null }
export type RepoOpts = { logger?: Logger }

export function makeConversationsRepo(db: DB, opts: RepoOpts = {}) {
  const log = opts.logger ?? noopLogger
  const base = { layer: 'repo' as const, table: 'conversations' as const }

  return {
    create({ title }: CreateConversationInput): { id: string } {
      const t0 = performance.now()
      const id = newId()
      const now = Date.now()
      db.insert(conversations)
        .values({ id, title, createdAt: now, updatedAt: now })
        .run()
      log.debug(
        { ...base, op: 'create', durationMs: round(performance.now() - t0), id },
        'repo.create',
      )
      return { id }
    },

    get(id: string): Conversation | null {
      const t0 = performance.now()
      const rows = db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1)
        .all()
      log.debug(
        {
          ...base,
          op: 'get',
          durationMs: round(performance.now() - t0),
          rowsAffected: rows.length,
        },
        'repo.get',
      )
      return rows[0] ?? null
    },

    list(): Conversation[] {
      const t0 = performance.now()
      const rows = db
        .select()
        .from(conversations)
        .orderBy(desc(conversations.updatedAt))
        .all()
      log.debug(
        {
          ...base,
          op: 'list',
          durationMs: round(performance.now() - t0),
          rowsAffected: rows.length,
        },
        'repo.list',
      )
      return rows
    },

    delete(id: string): void {
      const t0 = performance.now()
      db.delete(conversations).where(eq(conversations.id, id)).run()
      log.debug(
        { ...base, op: 'delete', durationMs: round(performance.now() - t0), id },
        'repo.delete',
      )
    },

    touch(id: string): void {
      const t0 = performance.now()
      db.update(conversations)
        .set({ updatedAt: Date.now() })
        .where(eq(conversations.id, id))
        .run()
      log.debug(
        { ...base, op: 'touch', durationMs: round(performance.now() - t0), id },
        'repo.touch',
      )
    },
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
