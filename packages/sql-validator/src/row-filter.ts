import pkg from 'node-sql-parser'
import type { AST, Select, Update, Delete } from 'node-sql-parser'
import { parseExpressionFragment } from './parse'

const { Parser } = pkg

const DIALECT = { database: 'postgresql' } as const
const parser = new Parser()

export type WhereBearingAst = Select | Update | Delete

export function injectRowFilter(ast: WhereBearingAst, rowFilter: string): boolean {
  const filterExpr = parseExpressionFragment(rowFilter)
  if (!filterExpr) return false

  ast.where = ast.where
    ? { type: 'binary_expr', operator: 'AND', left: ast.where, right: filterExpr, parentheses: true }
    : filterExpr

  return true
}

export function astToSql(ast: AST): string {
  return parser.sqlify(ast, DIALECT)
}
