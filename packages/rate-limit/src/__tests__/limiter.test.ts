import { describe, it, expect } from 'vitest'
import { createMemoryRateLimiter } from '../limiter'

describe('createMemoryRateLimiter', () => {
  it('allows consumption while under the configured points', async () => {
    const limiter = createMemoryRateLimiter()
    const options = { points: 3, duration: 60 }
    const first = await limiter.consume('user-1', options)
    const second = await limiter.consume('user-1', options)

    expect(first.allowed).toBe(true)
    expect(first.remainingPoints).toBe(2)
    expect(second.allowed).toBe(true)
    expect(second.remainingPoints).toBe(1)
  })

  it('rejects once the configured points are exhausted', async () => {
    const limiter = createMemoryRateLimiter()
    const options = { points: 2, duration: 60 }
    await limiter.consume('user-2', options)
    await limiter.consume('user-2', options)
    const third = await limiter.consume('user-2', options)

    expect(third.allowed).toBe(false)
    expect(third.remainingPoints).toBe(0)
    expect(third.msBeforeNext).toBeGreaterThan(0)
  })

  it('tracks separate keys independently', async () => {
    const limiter = createMemoryRateLimiter()
    const options = { points: 1, duration: 60 }
    await limiter.consume('org-a', options)
    const orgB = await limiter.consume('org-b', options)

    expect(orgB.allowed).toBe(true)
  })

  it('persists state across calls for the same (points, duration) configuration', async () => {
    const limiter = createMemoryRateLimiter()
    const options = { points: 1, duration: 60 }
    const first = await limiter.consume('user-3', options)
    const second = await limiter.consume('user-3', options)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(false)
  })
})
