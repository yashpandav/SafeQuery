import type { AST, Select, Join } from 'node-sql-parser'

export function extractTableNames(tableList: string[]): string[] {
  const names = new Set<string>()
  for (const entry of tableList) {
    const table = entry.split('::')[2]
    if (table) names.add(table)
  }
  return [...names]
}

export function hasLimitClause(ast: AST): boolean {
  if (ast.type !== 'select') return true
  return Boolean((ast as Select).limit?.value.length)
}

export function countJoins(ast: AST): number {
  if (ast.type !== 'select') return 0
  const from = (ast as Select).from
  if (!Array.isArray(from)) return 0
  return from.filter((f): f is Join => 'join' in f).length
}
