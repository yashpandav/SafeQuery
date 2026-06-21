import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'
import type { Redis } from 'ioredis'

export interface RateLimitConsumeOptions {
  points: number
  /** seconds */
  duration: number
}

export interface RateLimitResult {
  allowed: boolean
  remainingPoints: number
  msBeforeNext: number
}

export interface RateLimiter {
  consume(key: string, options: RateLimitConsumeOptions): Promise<RateLimitResult>
}

interface ConsumableLimiter {
  consume(key: string): Promise<RateLimiterRes>
}

async function consumeWith(limiter: ConsumableLimiter, key: string): Promise<RateLimitResult> {
  try {
    const res = await limiter.consume(key)
    return { allowed: true, remainingPoints: res.remainingPoints, msBeforeNext: res.msBeforeNext }
  } catch (rejection) {
    if (!(rejection instanceof RateLimiterRes)) throw rejection
    return { allowed: false, remainingPoints: rejection.remainingPoints, msBeforeNext: rejection.msBeforeNext }
  }
}

/**
 * Points/duration are configurable per call (e.g. per-org policy resolved at request time) rather
 * than fixed at construction. Safe for the Redis-backed limiter because the counter lives in Redis,
 * keyed by `key` — constructing a fresh `RateLimiterRedis` wrapper per call doesn't reset any state.
 */
export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    consume(key, { points, duration }) {
      return consumeWith(new RateLimiterRedis({ storeClient: redis, points, duration }), key)
    },
  }
}
export function createMemoryRateLimiter(): RateLimiter {
  const limiters = new Map<string, RateLimiterMemory>()
  return {
    consume(key, { points, duration }) {
      const cacheKey = `${points}:${duration}`
      let limiter = limiters.get(cacheKey)
      if (!limiter) {
        limiter = new RateLimiterMemory({ points, duration })
        limiters.set(cacheKey, limiter)
      }
      return consumeWith(limiter, key)
    },
  }
}
