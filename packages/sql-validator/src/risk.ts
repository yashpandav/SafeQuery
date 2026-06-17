import type { RiskLevel } from '@repo/types'
import type { ValidationViolation, StatementType, EnvironmentType } from './types'

export interface ClassifyRiskInput {
  violations: ValidationViolation[]
  statementType: StatementType
  environment: EnvironmentType
  unfilteredDestructiveWrite: boolean
}

export function classifyRisk(input: ClassifyRiskInput): RiskLevel {
  if (input.violations.some((v) => v.severity === 'error')) return 'SECURITY_INCIDENT'

  const isWrite = input.statementType !== 'select'

  if (isWrite) {
    if (input.environment === 'production') return 'CRITICAL'
    if (input.unfilteredDestructiveWrite) return 'CRITICAL'
    return 'WARNING'
  }

  const hasWarning = input.violations.some((v) => v.severity === 'warning')
  return hasWarning ? 'WARNING' : 'SAFE'
}
