import { createDbClient } from '@repo/db/client'
import { env } from '../env'
export const db = createDbClient(env.DATABASE_URL)
