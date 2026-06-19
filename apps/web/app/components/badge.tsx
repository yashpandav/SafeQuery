export type RiskTone = 'safe' | 'warning' | 'critical' | 'incident' | 'neutral'

const TONE_CLASS: Record<RiskTone, string> = {
  safe: 'bg-safe-bg text-safe',
  warning: 'bg-warning-bg text-warning',
  critical: 'bg-critical-bg text-critical',
  incident: 'bg-incident-bg text-incident',
  neutral: 'bg-neutral-bg text-neutral',
}

interface BadgeProps {
  tone: RiskTone
  children: React.ReactNode
  dot?: boolean
}

export function Badge({ tone, children, dot = true }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}
