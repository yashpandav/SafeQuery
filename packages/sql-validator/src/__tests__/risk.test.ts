import { describe, it, expect } from 'vitest'
import { classifyRisk } from '../risk'
import type { ValidationViolation } from '../types'

const noViolations: ValidationViolation[] = []
const warningOnly: ValidationViolation[] = [{ code: 'MISSING_LIMIT', severity: 'warning', message: 'x' }]
const errorPresent: ValidationViolation[] = [{ code: 'UNAUTHORIZED_TABLE', severity: 'error', message: 'x' }]

describe('classifyRisk', () => {
  it('classifies a clean bounded SELECT as SAFE', () => {
    expect(
      classifyRisk({
        violations: noViolations,
        statementType: 'select',
        environment: 'development',
        unfilteredDestructiveWrite: false,
      }),
    ).toBe('SAFE')
  })

  it('classifies a SELECT with structural warnings as WARNING', () => {
    expect(
      classifyRisk({
        violations: warningOnly,
        statementType: 'select',
        environment: 'development',
        unfilteredDestructiveWrite: false,
      }),
    ).toBe('WARNING')
  })

  it('classifies any error-severity violation as SECURITY_INCIDENT regardless of statement type', () => {
    expect(
      classifyRisk({
        violations: errorPresent,
        statementType: 'select',
        environment: 'development',
        unfilteredDestructiveWrite: false,
      }),
    ).toBe('SECURITY_INCIDENT')
  })

  it('classifies a filtered write in development as WARNING', () => {
    expect(
      classifyRisk({
        violations: noViolations,
        statementType: 'update',
        environment: 'development',
        unfilteredDestructiveWrite: false,
      }),
    ).toBe('WARNING')
  })

  it('classifies any write against production as CRITICAL even if filtered', () => {
    expect(
      classifyRisk({
        violations: noViolations,
        statementType: 'update',
        environment: 'production',
        unfilteredDestructiveWrite: false,
      }),
    ).toBe('CRITICAL')
  })

  it('classifies an unfiltered destructive write as CRITICAL even outside production', () => {
    expect(
      classifyRisk({
        violations: noViolations,
        statementType: 'delete',
        environment: 'development',
        unfilteredDestructiveWrite: true,
      }),
    ).toBe('CRITICAL')
  })

  it('SECURITY_INCIDENT always wins over CRITICAL conditions', () => {
    expect(
      classifyRisk({
        violations: errorPresent,
        statementType: 'delete',
        environment: 'production',
        unfilteredDestructiveWrite: true,
      }),
    ).toBe('SECURITY_INCIDENT')
  })
})
