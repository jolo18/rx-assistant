import { Database } from 'bun:sqlite'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.ts'

export type DB = BunSQLiteDatabase<typeof schema>

export type DbHandle = {
  db: DB
  sqlite: Database
  close: () => void
}

export type OpenDbOptions = {
  path: string // ':memory:' or filesystem path
  migrate?: boolean // default true; runs Drizzle migrations
}

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(here, '..', '..', 'drizzle')

export function openDb({ path, migrate: shouldMigrate = true }: OpenDbOptions): DbHandle {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true })
  }

  const sqlite = new Database(path)

  // F-15 — concurrent writers safe under WAL.
  sqlite.run('PRAGMA journal_mode = WAL;')
  sqlite.run('PRAGMA synchronous = NORMAL;')
  // SQLite ships with FK enforcement OFF; we need it for ON DELETE CASCADE.
  sqlite.run('PRAGMA foreign_keys = ON;')

  const db = drizzle(sqlite, { schema })

  if (shouldMigrate) {
    migrate(db, { migrationsFolder })
  }

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  }
}

export function pingDb(sqlite: Database): boolean {
  try {
    sqlite.query('SELECT 1').get()
    return true
  } catch {
    return false
  }
}
