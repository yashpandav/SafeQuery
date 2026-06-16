import { createDbClient } from '@repo/db/client'
import { env } from '../env'

// Singleton pool shared across all request handlers in this process.
// TRE executors create their own separate connections — they never share this pool.
export const db = createDbClient(env.DATABASE_URL)
