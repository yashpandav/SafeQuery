import type { WriteWindow } from './types'

function minutesSinceMidnight(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function currentMinutesInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

export function isWithinWriteWindow(now: Date, window: WriteWindow): boolean {
  const current = currentMinutesInZone(now, window.timezone)
  const start = minutesSinceMidnight(window.start)
  const end = minutesSinceMidnight(window.end)

  if (start === end) return true
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}
