import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CREDENTIAL_MASTER_KEY: z
    .string()
    .length(64, 'CREDENTIAL_MASTER_KEY must be 64 hex characters (32 bytes)'),
  STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DEFAULT_ROW_CAP: z.coerce.number().int().positive().default(10_000),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
