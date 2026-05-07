import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openDb, pingDb, type DbHandle } from '../../src/db/client'

describe('openDb', () => {
  let h: DbHandle

  beforeEach(() => {
    h = openDb({ path: ':memory:' })
  })

  afterEach(() => {
    h.close()
  })

  test('enables WAL journal mode (F-15)', () => {
    const row = h.sqlite.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()
    // :memory: SQLite reports `memory`; on-disk reports `wal`. WAL is what matters
    // for concurrency tests (I-10) which use file-backed DBs. For :memory: we can't
    // assert wal directly, but the PRAGMA must have been honored (no error).
    expect(row).not.toBeNull()
    expect(['wal', 'memory']).toContain(row!.journal_mode)
  })

  test('foreign keys are enforced (cascade requires this)', () => {
    const row = h.sqlite
      .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
      .get()
    expect(row?.foreign_keys).toBe(1)
  })

  test('synchronous mode is NORMAL', () => {
    const row = h.sqlite.query<{ synchronous: number }, []>('PRAGMA synchronous').get()
    // 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA
    expect(row?.synchronous).toBe(1)
  })

  test('migrations apply: conversations / messages / usage tables exist', () => {
    const tables = h.sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
      )
      .all()
      .map((r) => r.name)
    expect(tables).toContain('conversations')
    expect(tables).toContain('messages')
    expect(tables).toContain('usage')
  })

  test('pingDb returns true on a healthy connection', () => {
    expect(pingDb(h.sqlite)).toBe(true)
  })

  test('pingDb returns false after close', () => {
    h.sqlite.close()
    expect(pingDb(h.sqlite)).toBe(false)
  })
})

describe('openDb on disk', () => {
  test('WAL mode active on file-backed DB (F-15, I-10 prerequisite)', () => {
    const path = `/tmp/rx-assistant-test-${crypto.randomUUID()}.db`
    const h = openDb({ path })
    try {
      const row = h.sqlite
        .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
        .get()
      expect(row?.journal_mode).toBe('wal')
    } finally {
      h.close()
    }
  })
})
