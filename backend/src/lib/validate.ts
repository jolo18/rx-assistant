import { z } from 'zod'

export const MAX_MESSAGE_LENGTH = 50_000

/**
 * Spec §3.2 — body for `POST /api/chat`.
 * `conversationId` is `?: string` only — never `null` (Step 0.6 §4).
 */
export const ChatRequestSchema = z
  .object({
    message: z
      .string()
      .min(1, 'message must be a non-empty string')
      .max(MAX_MESSAGE_LENGTH, `message must be ≤ ${MAX_MESSAGE_LENGTH} characters`)
      .refine((s) => s.trim().length > 0, {
        message: 'message must contain non-whitespace content',
      }),
    conversationId: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .strict()

export type ChatRequest = z.infer<typeof ChatRequestSchema>

/** Spec §3.1 — `POST /api/conversations` body (used in Slice 7). */
export const CreateConversationSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
  })
  .strict()

export type CreateConversation = z.infer<typeof CreateConversationSchema>
