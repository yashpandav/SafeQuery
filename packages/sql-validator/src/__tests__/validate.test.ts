import { describe, it, expect } from 'vitest'
import type { CerbosPrincipal } from '@repo/policy-client'
import { validateSql } from '../validate'
import { createMockCerbosClient, FULL_ACCESS_ROLE, READ_ONLY_ROLE } from './test-helpers'

const ORG_ID = 'org-1'
const principal: CerbosPrincipal = { userId: 'user-1', platformRole: 'analyst', orgId: ORG_ID }

describe('validateSql — golden paths', () => {
  it('SAFE: a bounded, authorized SELECT', async () => {
    const result = await validateSql({
      sql: 'SELECT id, name FROM customers LIMIT 10',
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
    })
    expect(result.valid).toBe(true)
    expect(result.riskLevel).toBe('SAFE')
    expect(result.requiresApproval).toBe(false)
    expect(result.rewrittenSql).toContain("org_id = 'org-1'")
  })

  it('WARNING: a SELECT missing LIMIT', async () => {
    const result = await validateSql({
      sql: 'SELECT id, name FROM customers',
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
    })
    expect(result.valid).toBe(true)
    expect(result.riskLevel).toBe('WARNING')
    expect(result.violations.map((v) => v.code)).toContain('MISSING_LIMIT')
  })

  it('WARNING: a filtered write outside production', async () => {
    const result = await validateSql({
      sql: "UPDATE customers SET status = 'inactive' WHERE id = 1",
      cerbosClient: createMockCerbosClient(ORG_ID, FULL_ACCESS_ROLE),
      principal,
      customRole: FULL_ACCESS_ROLE,
      environment: 'staging',
    })
    expect(result.valid).toBe(true)
    expect(result.riskLevel).toBe('WARNING')
    expect(result.requiresApproval).toBe(false)
  })

  it('CRITICAL: any write against production requires approval', async () => {
    const result = await validateSql({
      sql: "UPDATE customers SET status = 'inactive' WHERE id = 1",
      cerbosClient: createMockCerbosClient(ORG_ID, FULL_ACCESS_ROLE),
      principal,
      customRole: FULL_ACCESS_ROLE,
      environment: 'production',
    })
    expect(result.valid).toBe(true)
    expect(result.riskLevel).toBe('CRITICAL')
    expect(result.requiresApproval).toBe(true)
  })

  it('CRITICAL: DELETE with no WHERE clause and no row filter configured', async () => {
    const role = { ...FULL_ACCESS_ROLE, rowFilters: {} }
    const result = await validateSql({
      sql: 'DELETE FROM customers',
      cerbosClient: createMockCerbosClient(ORG_ID, role),
      principal,
      customRole: role,
      environment: 'development',
    })
    expect(result.valid).toBe(true)
    expect(result.riskLevel).toBe('CRITICAL')
    expect(result.requiresApproval).toBe(true)
  })

  it('a row filter is injected even when the model omits any WHERE clause', async () => {
    const result = await validateSql({
      sql: 'SELECT * FROM customers',
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
    })
    expect(result.rewrittenSql).toContain("org_id = 'org-1'")
  })
})

describe('validateSql — PII masking (SQ-052)', () => {
  const schemaSnapshot = {
    customers: [
      { column: 'id', type: 'uuid', nullable: false, isPii: false },
      { column: 'email', type: 'text', nullable: false, isPii: true },
      { column: 'ssn', type: 'text', nullable: true, isPii: true },
    ],
  }

  it('masks every isPii column on the queried table by default', async () => {
    const result = await validateSql({
      sql: 'SELECT id, email, ssn FROM customers LIMIT 10',
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
      schemaSnapshot,
    })
    expect(result.maskedColumns.sort()).toEqual(['email', 'ssn'])
  })

  it('masks nothing when the role sets maskPii: false', async () => {
    const role = { ...READ_ONLY_ROLE, maskPii: false }
    const result = await validateSql({
      sql: 'SELECT id, email, ssn FROM customers LIMIT 10',
      cerbosClient: createMockCerbosClient(ORG_ID, role),
      principal,
      customRole: role,
      environment: 'development',
      schemaSnapshot,
    })
    expect(result.maskedColumns).toEqual([])
  })

  it('masks nothing when no schema snapshot is supplied (no PII data to act on)', async () => {
    const result = await validateSql({
      sql: 'SELECT id, email, ssn FROM customers LIMIT 10',
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
    })
    expect(result.maskedColumns).toEqual([])
  })

  it('never masks a non-PII column', async () => {
    const result = await validateSql({
      sql: 'SELECT id FROM customers LIMIT 10',
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
      schemaSnapshot,
    })
    expect(result.maskedColumns).not.toContain('id')
  })
})

describe('validateSql — adversarial corpus (must always reject as SECURITY_INCIDENT)', () => {
  const blockComment = ['/', '*', ' sneaky ', '*', '/'].join('')
  const cases: Array<{ name: string; sql: string }> = [
    { name: 'stacked statement injection', sql: 'SELECT * FROM customers; DROP TABLE customers' },
    { name: 'stacked statement with two benign selects', sql: 'SELECT * FROM customers; SELECT * FROM orders' },
    { name: 'comment-based injection attempt', sql: "SELECT * FROM customers -- ; DROP TABLE customers" },
    { name: 'block comment smuggling', sql: `SELECT * FROM customers ${blockComment} WHERE id = 1` },
    { name: 'DROP TABLE', sql: 'DROP TABLE customers' },
    { name: 'TRUNCATE', sql: 'TRUNCATE TABLE customers' },
    { name: 'ALTER TABLE', sql: 'ALTER TABLE customers ADD COLUMN backdoor text' },
    { name: 'CREATE TABLE', sql: 'CREATE TABLE backdoor (id int)' },
    { name: 'unqualified system catalog access', sql: 'SELECT * FROM pg_user' },
    { name: 'information_schema access', sql: 'SELECT * FROM information_schema.tables' },
    { name: 'pg_catalog access', sql: 'SELECT * FROM pg_catalog.pg_user' },
    { name: 'unparseable garbage', sql: 'this is not valid sql at all !!!' },
    { name: 'empty input', sql: '' },
  ]

  for (const { name, sql } of cases) {
    it(`rejects: ${name}`, async () => {
      const result = await validateSql({
        sql,
        cerbosClient: createMockCerbosClient(ORG_ID, FULL_ACCESS_ROLE),
        principal,
        customRole: FULL_ACCESS_ROLE,
        environment: 'development',
      })
      expect(result.valid).toBe(false)
      expect(result.riskLevel).toBe('SECURITY_INCIDENT')
      expect(result.rewrittenSql).toBeNull()
    })
  }

  it('rejects access to a table outside the custom role table scope (privilege escalation)', async () => {
    const result = await validateSql({
      sql: 'SELECT * FROM admin_secrets',
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
    })
    expect(result.valid).toBe(false)
    expect(result.riskLevel).toBe('SECURITY_INCIDENT')
    expect(result.violations.map((v) => v.code)).toContain('UNAUTHORIZED_TABLE')
  })

  it('rejects a write action the custom role does not grant', async () => {
    const result = await validateSql({
      sql: "DELETE FROM customers WHERE id = 1",
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
    })
    expect(result.valid).toBe(false)
    expect(result.violations.map((v) => v.code)).toContain('UNAUTHORIZED_TABLE')
  })

  it('rejects a column outside the custom role column allowlist', async () => {
    const role = { ...READ_ONLY_ROLE, allowedColumns: { customers: ['id', 'name'] } }
    const result = await validateSql({
      sql: 'SELECT id, ssn FROM customers',
      cerbosClient: createMockCerbosClient(ORG_ID, role),
      principal,
      customRole: role,
      environment: 'development',
    })
    expect(result.valid).toBe(false)
    expect(result.violations.map((v) => v.code)).toContain('UNAUTHORIZED_COLUMN')
  })

  it('rejects cross-tenant access even when the table name matches', async () => {
    const otherOrgPrincipal: CerbosPrincipal = { userId: 'user-2', platformRole: 'analyst', orgId: 'org-2' }
    const result = await validateSql({
      sql: 'SELECT * FROM customers',
      cerbosClient: createMockCerbosClient(ORG_ID, READ_ONLY_ROLE),
      principal: otherOrgPrincipal,
      customRole: READ_ONLY_ROLE,
      environment: 'development',
    })
    expect(result.valid).toBe(false)
    expect(result.riskLevel).toBe('SECURITY_INCIDENT')
  })
})
