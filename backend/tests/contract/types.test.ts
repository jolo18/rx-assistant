/**
 * C-2 — typecheck-only contract.
 *
 * Asserts that `loadHistory(...)` (returning our `Message[]`) can be
 * structurally massaged into AI SDK `ModelMessage[]` via
 * `storedToModelMessages`. The body of the function below never runs at
 * runtime; the *file compiling* under `tsc --noEmit` is the contract.
 *
 * If a future refactor breaks the alignment between `db/schema.ts` and
 * AI SDK's `ModelMessage` shape, this file will fail to compile.
 */
import { test } from 'bun:test'
import type { ModelMessage } from 'ai'
import { storedToModelMessages } from '../../src/agent/translate'
import type { Message } from '../../src/db/schema'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeCheck(): ModelMessage[] {
  const stored: Message[] = []
  return storedToModelMessages(stored)
}

test('C-2 — loadHistory return shape is assignable to ModelMessage[]', () => {
  // Compile-time assertion above; runtime is a no-op.
  const out = storedToModelMessages([])
  if (!Array.isArray(out)) throw new Error('expected an array at runtime')
})
