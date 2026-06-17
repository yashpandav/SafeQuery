import { checkDbTable } from '@repo/policy-client'
import type { CerbosClient, CerbosPrincipal, DbTableAction } from '@repo/policy-client'
import type { CustomRoleConfig, AllowedAction } from '@repo/types'
import { parseStatement } from './parse'
import { validateStatementType, detectForbiddenTables, detectComments } from './forbidden'
import { detectUnauthorizedColumns } from './columns'
import { extractTableNames, hasLimitClause, countJoins } from './ast-utils'
import { injectRowFilter, astToSql } from './row-filter'
import { classifyRisk } from './risk'
import type { ValidatorOutput, ValidationViolation, EnvironmentType } from './types'

export interface ValidateSqlInput {
  sql: string
  cerbosClient: CerbosClient
  principal: CerbosPrincipal
  customRole: CustomRoleConfig
  environment: EnvironmentType
}

const ACTION_TO_DB_TABLE_ACTION: Record<AllowedAction, DbTableAction> = {
  SELECT: 'select',
  INSERT: 'insert',
  UPDATE: 'update',
  DELETE: 'delete',
}

export async function validateSql(input: ValidateSqlInput): Promise<ValidatorOutput> {
  const violations: ValidationViolation[] = []

  const parsed = parseStatement(input.sql)
  if (!parsed.ok) {
    return fail([
      parsed.reason === 'MULTI_STATEMENT'
        ? { code: 'MULTI_STATEMENT', severity: 'error', message: 'Multiple SQL statements are not allowed' }
        : { code: 'PARSE_ERROR', severity: 'error', message: 'SQL could not be parsed' },
    ])
  }
  const { ast, tableList, columnList } = parsed.statement

  if (detectComments(input.sql)) {
    violations.push({
      code: 'COMMENT_DETECTED',
      severity: 'error',
      message: 'SQL comments are not allowed in generated queries',
    })
  }

  const typeCheck = validateStatementType(ast)
  if (!typeCheck.ok) {
    return fail([
      ...violations,
      { code: 'FORBIDDEN_STATEMENT_TYPE', severity: 'error', message: `Statement type "${ast.type}" is not permitted` },
    ])
  }
  const statementType = typeCheck.type

  for (const table of detectForbiddenTables(tableList)) {
    violations.push({
      code: 'FORBIDDEN_TABLE',
      severity: 'error',
      message: `Access to system table "${table}" is not permitted`,
      table,
    })
  }

  const tables = extractTableNames(tableList)
  violations.push(...detectUnauthorizedColumns(columnList, input.customRole.allowedColumns, tables))

  if (violations.some((v) => v.severity === 'error')) return fail(violations)

  const tableAuthorizations: { table: string; rowFilter: string | null; maskedColumns: string[] }[] = []

  for (const table of tables) {
    const decision = await checkDbTable(
      input.cerbosClient,
      input.principal,
      {
        tableScope: input.customRole.allowedTables,
        capabilities: input.customRole.allowedActions.map((a) => ACTION_TO_DB_TABLE_ACTION[a]),
        rowFilter: input.customRole.rowFilters[table] ?? null,
        maskedColumns: [],
      },
      { table, orgId: input.principal.orgId },
      [statementType],
    )

    if (!decision.allowed[statementType]) {
      violations.push({
        code: 'UNAUTHORIZED_TABLE',
        severity: 'error',
        message: `Not authorized to ${statementType} on table "${table}"`,
        table,
      })
      continue
    }

    tableAuthorizations.push({ table, rowFilter: decision.rowFilter, maskedColumns: decision.maskedColumns })
  }

  if (violations.some((v) => v.severity === 'error')) return fail(violations)

  const hadOriginalWhere =
    (ast.type === 'select' || ast.type === 'update' || ast.type === 'delete') && ast.where !== null

  if (ast.type === 'select' || ast.type === 'update' || ast.type === 'delete') {
    for (const auth of tableAuthorizations) {
      if (auth.rowFilter && !injectRowFilter(ast, auth.rowFilter)) {
        violations.push({
          code: 'ROW_FILTER_INVALID',
          severity: 'error',
          message: `Row filter for table "${auth.table}" could not be applied`,
          table: auth.table,
        })
      }
    }
  }

  if (violations.some((v) => v.severity === 'error')) return fail(violations)

  if (statementType === 'select' && !hasLimitClause(ast)) {
    violations.push({ code: 'MISSING_LIMIT', severity: 'warning', message: 'Query has no LIMIT clause' })
  }
  const joinCount = countJoins(ast)
  if (joinCount > 3) {
    violations.push({ code: 'EXCESSIVE_JOINS', severity: 'warning', message: `Query joins ${joinCount} tables` })
  }

  const hasAnyRowFilter = tableAuthorizations.some((a) => a.rowFilter !== null)
  const unfilteredDestructiveWrite =
    (statementType === 'update' || statementType === 'delete') && !hadOriginalWhere && !hasAnyRowFilter
  if (unfilteredDestructiveWrite) {
    violations.push({
      code: 'UNFILTERED_DESTRUCTIVE_WRITE',
      severity: 'warning',
      message: `${statementType.toUpperCase()} has no WHERE clause and no row filter was applied`,
    })
  }

  const rewrittenSql = astToSql(ast)
  const maskedColumns = [...new Set(tableAuthorizations.flatMap((a) => a.maskedColumns))]
  const riskLevel = classifyRisk({
    violations,
    statementType,
    environment: input.environment,
    unfilteredDestructiveWrite,
  })

  return {
    valid: true,
    rewrittenSql,
    statementType,
    tables,
    riskLevel,
    requiresApproval: riskLevel === 'CRITICAL',
    violations,
    maskedColumns,
    rowCap: input.customRole.rowCap,
  }
}

function fail(violations: ValidationViolation[]): ValidatorOutput {
  return {
    valid: false,
    rewrittenSql: null,
    statementType: null,
    tables: [],
    riskLevel: 'SECURITY_INCIDENT',
    requiresApproval: false,
    violations,
    maskedColumns: [],
    rowCap: null,
  }
}
