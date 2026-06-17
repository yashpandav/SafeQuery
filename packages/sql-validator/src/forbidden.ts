import type { AST } from 'node-sql-parser'
import type { StatementType } from './types'

const ALLOWED_STATEMENT_TYPES: ReadonlySet<string> = new Set(['select', 'insert', 'update', 'delete'])

const FORBIDDEN_SCHEMAS: ReadonlySet<string> = new Set(['information_schema', 'pg_catalog'])
const FORBIDDEN_TABLE_PREFIX = /^pg_/i

export function validateStatementType(ast: AST): { ok: true; type: StatementType } | { ok: false } {
  if (ALLOWED_STATEMENT_TYPES.has(ast.type)) {
    return { ok: true, type: ast.type as StatementType }
  }
  return { ok: false }
}

export function detectForbiddenTables(tableList: string[]): string[] {
  const forbidden = new Set<string>()

  for (const entry of tableList) {
    const parts = entry.split('::')
    const schema = parts[1]
    const table = parts[2] ?? ''
    if (!table) continue

    if (schema && schema !== 'null' && FORBIDDEN_SCHEMAS.has(schema.toLowerCase())) {
      forbidden.add(table)
    } else if (FORBIDDEN_TABLE_PREFIX.test(table)) {
      forbidden.add(table)
    }
  }

  return [...forbidden]
}

const COMMENT_PATTERN = /(--[^\n]*)|(\/\*[\s\S]*?\*\/)/

export function detectComments(rawSql: string): boolean {
  return COMMENT_PATTERN.test(stripQuotedStrings(rawSql))
}

function stripQuotedStrings(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
}
