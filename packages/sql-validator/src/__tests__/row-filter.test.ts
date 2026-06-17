import { describe, it, expect } from 'vitest'
import { Parser } from 'node-sql-parser'
import { parseStatement } from '../parse'
import { injectRowFilter, astToSql, type WhereBearingAst } from '../row-filter'

const parser = new Parser()

function parseAndInject(sql: string, filter: string) {
  const result = parseStatement(sql)
  if (!result.ok) throw new Error('expected parse success')
  const ast = result.statement.ast as WhereBearingAst
  const ok = injectRowFilter(ast, filter)
  return { ok, sql: astToSql(ast) }
}

describe('injectRowFilter', () => {
  it('adds a WHERE clause when none existed', () => {
    const { ok, sql } = parseAndInject('SELECT * FROM customers', "org_id = 'org-1'")
    expect(ok).toBe(true)
    expect(sql).toContain('WHERE')
    expect(sql).toContain("org_id = 'org-1'")
  })

  it('ANDs the filter onto an existing WHERE clause without dropping it', () => {
    const { ok, sql } = parseAndInject("SELECT * FROM customers WHERE status = 'active'", "org_id = 'org-1'")
    expect(ok).toBe(true)
    expect(sql).toContain("status = 'active'")
    expect(sql).toContain("org_id = 'org-1'")
    expect(sql).toMatch(/AND/i)
  })

  it('still applies the filter even when the model omitted any WHERE clause for a destructive write', () => {
    const { ok, sql } = parseAndInject('DELETE FROM customers', "org_id = 'org-1'")
    expect(ok).toBe(true)
    expect(sql).toContain('WHERE')
    expect(sql).toContain("org_id = 'org-1'")
  })

  it('fails closed when the row filter itself does not parse as a single expression', () => {
    const { ok } = parseAndInject('SELECT * FROM customers', '1=1; DROP TABLE customers--')
    expect(ok).toBe(false)
  })

  it('re-parses cleanly: rewritten SQL still references the original table', () => {
    const { sql } = parseAndInject('SELECT * FROM customers', "org_id = 'org-1'")
    const { tableList } = parser.parse(sql, { database: 'postgresql' })
    expect(tableList).toContain('select::null::customers')
  })
})
