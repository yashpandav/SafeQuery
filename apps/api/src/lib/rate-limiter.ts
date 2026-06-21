import { createRedisRateLimiter } from '@repo/rate-limit'
import { createRedisConnection } from '@repo/queue'
import { env } from '../env'

const connection = createRedisConnection(env.REDIS_URL)

export const rateLimiter = createRedisRateLimiter(connection)
