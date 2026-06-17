import { describe, it, expect } from 'vitest'
import { Parser } from 'node-sql-parser'
import { detectUnauthorizedColumns } from '../columns'

const parser = new Parser()
function columnList(sql: string) {
  return parser.parse(sql, { database: 'postgresql' }).columnList
}

describe('detectUnauthorizedColumns', () => {
  it('allows everything when no restriction is configured for the table', () => {
    const violations = detectUnauthorizedColumns(columnList('SELECT ssn, salary FROM employees'), {}, ['employees'])
    expect(violations).toEqual([])
  })

  it('allows explicitly permitted columns on an unqualified single-table query', () => {
    const violations = detectUnauthorizedColumns(
      columnList('SELECT id, name FROM employees'),
      { employees: ['id', 'name'] },
      ['employees'],
    )
    expect(violations).toEqual([])
  })

  it('flags a column outside the allowlist on an unqualified single-table query', () => {
    const violations = detectUnauthorizedColumns(
      columnList('SELECT id, salary FROM employees'),
      { employees: ['id', 'name'] },
      ['employees'],
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ code: 'UNAUTHORIZED_COLUMN', table: 'employees' })
  })

  it('flags a restricted column referenced via an explicit table qualifier', () => {
    const violations = detectUnauthorizedColumns(
      columnList('SELECT employees.salary FROM employees'),
      { employees: ['id', 'name'] },
      ['employees'],
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.code).toBe('UNAUTHORIZED_COLUMN')
  })

  it('rejects SELECT * when column restrictions are configured for the table', () => {
    const violations = detectUnauthorizedColumns(
      columnList('SELECT * FROM employees'),
      { employees: ['id', 'name'] },
      ['employees'],
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.code).toBe('UNAUTHORIZED_COLUMN')
  })

  it('allows SELECT * when no restriction is configured', () => {
    const violations = detectUnauthorizedColumns(columnList('SELECT * FROM employees'), {}, ['employees'])
    expect(violations).toEqual([])
  })

  it('fails closed on an unattributable column in a restricted multi-table join', () => {
    const violations = detectUnauthorizedColumns(
      columnList('SELECT shared_col FROM employees JOIN departments ON employees.dept_id = departments.id'),
      { employees: ['id', 'name'] },
      ['employees', 'departments'],
    )
    expect(violations.some((v) => v.code === 'UNAUTHORIZED_COLUMN')).toBe(true)
  })
})
