import { describe, it, expect } from 'vitest'
import { isWithinWriteWindow } from '../write-window'

describe('isWithinWriteWindow', () => {
  it('allows a time inside a same-day window', () => {
    const now = new Date('2026-01-15T12:00:00Z')
    expect(isWithinWriteWindow(now, { start: '09:00', end: '17:00', timezone: 'UTC' })).toBe(true)
  })

  it('rejects a time outside a same-day window', () => {
    const now = new Date('2026-01-15T20:00:00Z')
    expect(isWithinWriteWindow(now, { start: '09:00', end: '17:00', timezone: 'UTC' })).toBe(false)
  })

  it('treats the window end as exclusive', () => {
    const now = new Date('2026-01-15T17:00:00Z')
    expect(isWithinWriteWindow(now, { start: '09:00', end: '17:00', timezone: 'UTC' })).toBe(false)
  })

  it('handles a window that wraps past midnight', () => {
    const insideLate = new Date('2026-01-15T23:00:00Z')
    const insideEarly = new Date('2026-01-15T03:00:00Z')
    const outside = new Date('2026-01-15T12:00:00Z')
    const window = { start: '22:00', end: '06:00', timezone: 'UTC' }
    expect(isWithinWriteWindow(insideLate, window)).toBe(true)
    expect(isWithinWriteWindow(insideEarly, window)).toBe(true)
    expect(isWithinWriteWindow(outside, window)).toBe(false)
  })

  it('treats a degenerate start === end window as unrestricted', () => {
    const now = new Date('2026-01-15T03:00:00Z')
    expect(isWithinWriteWindow(now, { start: '09:00', end: '09:00', timezone: 'UTC' })).toBe(true)
  })

  it('evaluates the window in the configured timezone, not UTC', () => {
    // 2026-01-15T17:00:00Z is noon in America/New_York (EST, UTC-5, no DST in January)
    const now = new Date('2026-01-15T17:00:00Z')
    expect(isWithinWriteWindow(now, { start: '09:00', end: '17:00', timezone: 'America/New_York' })).toBe(true)
    expect(isWithinWriteWindow(now, { start: '09:00', end: '17:00', timezone: 'UTC' })).toBe(false)
  })
})
