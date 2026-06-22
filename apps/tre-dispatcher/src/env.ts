import { z } from 'zod'
import { logger } from './logger'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MAX_CONCURRENT_JOBS_PER_ORG: z.coerce.number().int().positive().default(3),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  logger.error({ fieldErrors: parsed.error.flatten().fieldErrors }, 'Invalid environment variables')
  process.exit(1)
}

export const env = parsed.data
