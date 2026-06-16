import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PASETO_LOCAL_KEY: z
    .string()
    .length(64, 'PASETO_LOCAL_KEY must be 64 hex characters (32 bytes)'),
  KEYCLOAK_URL: z.string().url('KEYCLOAK_URL must be a valid URL'),
  KEYCLOAK_REALM: z.string().min(1).default('safequery'),
  CERBOS_URL: z.string().url('CERBOS_URL must be a valid URL').default('http://localhost:3592'),
  CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
