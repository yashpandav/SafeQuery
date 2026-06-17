import { describe, it, expect } from 'vitest'
import { parseStatement, parseExpressionFragment } from '../parse'

describe('parseStatement', () => {
  it('parses a plain SELECT', () => {
    const result = parseStatement('SELECT id, name FROM customers')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.statement.ast.type).toBe('select')
      expect(result.statement.tableList).toContain('select::null::customers')
    }
  })

  it('tolerates a single trailing semicolon', () => {
    const result = parseStatement('SELECT 1 FROM customers;')
    expect(result.ok).toBe(true)
  })

  it('rejects empty input', () => {
    expect(parseStatement('').ok).toBe(false)
    expect(parseStatement('   ').ok).toBe(false)
  })

  it('rejects unparseable garbage', () => {
    const result = parseStatement('this is not sql at all !!! ###')
    expect(result).toEqual({ ok: false, reason: 'PARSE_ERROR' })
  })

  it('rejects stacked statements (statement-injection attempt)', () => {
    const result = parseStatement('SELECT * FROM customers; DROP TABLE customers')
    expect(result).toEqual({ ok: false, reason: 'MULTI_STATEMENT' })
  })

  it('rejects stacked statements even when both are benign SELECTs', () => {
    const result = parseStatement('SELECT * FROM a; SELECT * FROM b')
    expect(result).toEqual({ ok: false, reason: 'MULTI_STATEMENT' })
  })
})

describe('parseExpressionFragment', () => {
  it('parses a simple equality predicate', () => {
    const expr = parseExpressionFragment("org_id = 'abc-123'")
    expect(expr).not.toBeNull()
    expect(expr?.type).toBe('binary_expr')
  })

  it('parses a named-parameter predicate', () => {
    const expr = parseExpressionFragment('org_id = :org_id')
    expect(expr).not.toBeNull()
  })

  it('rejects a fragment that smuggles a second statement', () => {
    expect(parseExpressionFragment('1=1; DROP TABLE users--')).toBeNull()
  })

  it('rejects a fragment with trailing garbage after the expression', () => {
    expect(parseExpressionFragment('1=1 OR 1=1; SELECT pg_sleep(1)')).toBeNull()
  })

  it('rejects an empty fragment', () => {
    expect(parseExpressionFragment('')).toBeNull()
  })

  it('rejects a non-expression fragment', () => {
    expect(parseExpressionFragment('DROP TABLE users')).toBeNull()
  })
})
