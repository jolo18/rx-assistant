import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  // Live DB path resolved from env at runtime; for drizzle-kit CLI we use a placeholder.
  dbCredentials: { url: process.env.DATABASE_PATH ?? './data/app.db' },
})
