import type { CustomRoleConfig } from '@repo/types'
import type { ValidationViolation } from './types'

const WILDCARD_COLUMN = /^\(\.\*\)$|^\*$/

export function detectUnauthorizedColumns(
  columnList: string[],
  allowedColumns: CustomRoleConfig['allowedColumns'],
  tables: string[],
): ValidationViolation[] {
  const violations: ValidationViolation[] = []
  const singleTable = tables.length === 1 ? tables[0] : null
  const anyRestrictionConfigured = tables.some((t) => (allowedColumns[t]?.length ?? 0) > 0)

  for (const entry of columnList) {
    const parts = entry.split('::')
    let table = parts[1]
    const column = parts[2] ?? ''
    if (!column) continue

    if (!table || table === 'null') {
      if (singleTable) {
        table = singleTable
      } else if (anyRestrictionConfigured) {
        violations.push({
          code: 'UNAUTHORIZED_COLUMN',
          severity: 'error',
          message: `Column "${column}" could not be attributed to a single table in a restricted multi-table query`,
        })
        continue
      } else {
        continue
      }
    }

    const restriction = allowedColumns[table]
    if (!restriction || restriction.length === 0) continue

    if (WILDCARD_COLUMN.test(column)) {
      violations.push({
        code: 'UNAUTHORIZED_COLUMN',
        severity: 'error',
        message: `SELECT * is not permitted on "${table}" — column access is restricted`,
        table,
      })
      continue
    }

    if (!restriction.includes(column)) {
      violations.push({
        code: 'UNAUTHORIZED_COLUMN',
        severity: 'error',
        message: `Column "${column}" on table "${table}" is not permitted`,
        table,
      })
    }
  }

  return violations
}
