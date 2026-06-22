import { z } from 'zod'
import { logger } from './logger'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  AI_MODEL: z.string().min(1).default('gpt-5.5'),
  AI_SCREEN_MODEL: z.string().min(1).default('gpt-5.4-nano'),
  SERVICE_PUBLIC_KEY: z.string().min(1, 'SERVICE_PUBLIC_KEY is required'),
  CORS_ORIGIN: z.string().url().default('http://localhost:3001'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  logger.error({ fieldErrors: parsed.error.flatten().fieldErrors }, 'Invalid environment variables')
  process.exit(1)
}

export const env = parsed.data
