import { z } from 'zod'

const EnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required'),
  OPENROUTER_MODEL: z.string().min(1).default('anthropic/claude-sonnet-4.6'),
  MAX_AGENT_STEPS: z.coerce.number().int().positive().default(8),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DATABASE_PATH: z.string().min(1).default('./data/app.db'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  LOG_PRETTY: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .default(false)
    .transform((v) => v === true || v === 'true'),
  CORS_ORIGINS: z.string().default('*'),
})

export type Env = z.infer<typeof EnvSchema>

export function parseEnv(input: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return result.data
}
