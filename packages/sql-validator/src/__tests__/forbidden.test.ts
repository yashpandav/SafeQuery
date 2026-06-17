import { describe, it, expect } from 'vitest'
import { Parser } from 'node-sql-parser'
import type { AST } from 'node-sql-parser'
import { validateStatementType, detectForbiddenTables, detectComments } from '../forbidden'

const parser = new Parser()
function astify(sql: string): AST {
  const result = parser.astify(sql, { database: 'postgresql' })
  return Array.isArray(result) ? result[0]! : result
}
function tableList(sql: string) {
  return parser.parse(sql, { database: 'postgresql' }).tableList
}

describe('validateStatementType', () => {
  it('allows select/insert/update/delete', () => {
    for (const sql of [
      'SELECT * FROM t',
      'INSERT INTO t (a) VALUES (1)',
      'UPDATE t SET a = 1',
      'DELETE FROM t',
    ]) {
      expect(validateStatementType(astify(sql))).toEqual(expect.objectContaining({ ok: true }))
    }
  })

  it('rejects DDL and destructive non-DML operations', () => {
    for (const sql of [
      'DROP TABLE t',
      'CREATE TABLE t (id int)',
      'ALTER TABLE t ADD COLUMN x int',
      'TRUNCATE TABLE t',
    ]) {
      expect(validateStatementType(astify(sql))).toEqual({ ok: false })
    }
  })
})

describe('detectForbiddenTables', () => {
  it('allows ordinary user tables', () => {
    expect(detectForbiddenTables(tableList('SELECT * FROM customers'))).toEqual([])
  })

  it('flags unqualified pg_ catalog tables', () => {
    expect(detectForbiddenTables(tableList('SELECT * FROM pg_user'))).toContain('pg_user')
  })

  it('flags information_schema access', () => {
    expect(detectForbiddenTables(tableList('SELECT * FROM information_schema.tables'))).toContain('tables')
  })

  it('flags pg_catalog access', () => {
    expect(detectForbiddenTables(tableList('SELECT * FROM pg_catalog.pg_user'))).toContain('pg_user')
  })

  it('does not flag a legitimate table that merely contains "pg" elsewhere', () => {
    expect(detectForbiddenTables(tableList('SELECT * FROM shipping_data'))).toEqual([])
  })
})

describe('detectComments', () => {
  it('flags line comments', () => {
    expect(detectComments("SELECT * FROM t WHERE id = 1 -- and more")).toBe(true)
  })

  it('flags block comments', () => {
    expect(detectComments('SELECT * FROM t  WHERE id = 1')).toBe(true)
  })

  it('does not flag a clean query', () => {
    expect(detectComments("SELECT * FROM t WHERE name = 'no comment here'")).toBe(false)
  })

  it('does not false-positive on a string literal containing dashes', () => {
    expect(detectComments("SELECT * FROM t WHERE code = 'AB--12'")).toBe(false)
  })
})
