import { Parser } from 'node-sql-parser'
import type { AST, Select } from 'node-sql-parser'

const DIALECT = { database: 'postgresql' } as const

const parser = new Parser()

export interface ParsedStatement {
  ast: AST
  tableList: string[]
  columnList: string[]
}

export type ParseResult =
  | { ok: true; statement: ParsedStatement }
  | { ok: false; reason: 'EMPTY' | 'PARSE_ERROR' | 'MULTI_STATEMENT' }

export function parseStatement(sql: string): ParseResult {
  if (!sql.trim()) return { ok: false, reason: 'EMPTY' }

  let raw: { tableList: string[]; columnList: string[]; ast: AST | AST[] }
  try {
    raw = parser.parse(sql, DIALECT)
  } catch {
    return { ok: false, reason: 'PARSE_ERROR' }
  }

  const statements = Array.isArray(raw.ast) ? raw.ast : [raw.ast]
  if (statements.length !== 1) return { ok: false, reason: 'MULTI_STATEMENT' }

  return {
    ok: true,
    statement: { ast: statements[0]!, tableList: raw.tableList, columnList: raw.columnList },
  }
}

export type ExpressionFragment = NonNullable<Select['where']>

export function parseExpressionFragment(fragment: string): ExpressionFragment | null {
  const probe = `SELECT 1 FROM __safequery_row_filter_probe__ WHERE ${fragment}`

  let result: AST | AST[]
  try {
    result = parser.astify(probe, DIALECT)
  } catch {
    return null
  }

  const statements = Array.isArray(result) ? result : [result]
  if (statements.length !== 1) return null

  const statement = statements[0]!
  if (statement.type !== 'select') return null

  return (statement as Select).where ?? null
}
