import { desc, eq } from 'drizzle-orm'
import type { DB } from '../client.ts'
import { newId } from '../../lib/ids.ts'
import { conversations, type Conversation } from '../schema.ts'

export type CreateConversationInput = { title: string | null }

export function makeConversationsRepo(db: DB) {
  return {
    create({ title }: CreateConversationInput): { id: string } {
      const id = newId()
      const now = Date.now()
      db.insert(conversations)
        .values({ id, title, createdAt: now, updatedAt: now })
        .run()
      return { id }
    },

    get(id: string): Conversation | null {
      const rows = db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1)
        .all()
      return rows[0] ?? null
    },

    list(): Conversation[] {
      return db.select().from(conversations).orderBy(desc(conversations.updatedAt)).all()
    },

    delete(id: string): void {
      db.delete(conversations).where(eq(conversations.id, id)).run()
    },

    touch(id: string): void {
      db.update(conversations)
        .set({ updatedAt: Date.now() })
        .where(eq(conversations.id, id))
        .run()
    },
  }
}
