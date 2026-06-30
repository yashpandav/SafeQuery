import { z } from 'zod'
import { logger } from './logger'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CREDENTIAL_MASTER_KEY: z
    .string()
    .length(64, 'CREDENTIAL_MASTER_KEY must be 64 hex characters (32 bytes)'),
  STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DEFAULT_ROW_CAP: z.coerce.number().int().positive().default(10_000),
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  logger.error({ fieldErrors: parsed.error.flatten().fieldErrors }, 'Invalid environment variables')
  process.exit(1)
}

export const env = parsed.data
