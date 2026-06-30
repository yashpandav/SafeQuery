import { createRedisConnection } from '@repo/queue'
import { env } from '../env'

const PREFIX = 'session:blocked:'
const TTL_SECONDS = 8 * 60 * 60

const redis = createRedisConnection(env.REDIS_URL)

export const sessionBlocklist = {
  async block(sessionId: string): Promise<void> {
    await redis.set(`${PREFIX}${sessionId}`, '1', 'EX', TTL_SECONDS)
  },
  async isBlocked(sessionId: string): Promise<boolean> {
    return (await redis.exists(`${PREFIX}${sessionId}`)) === 1
  },
}

export type SessionBlocklist = typeof sessionBlocklist
