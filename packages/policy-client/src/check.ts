import type { CerbosClient } from './client'
import type {
  CerbosPrincipal,
  QueryResourceAttrs,
  ApprovalResourceAttrs,
  DatabaseConnectionResourceAttrs,
  AuditLogResourceAttrs,
  DbTableResourceAttrs,
  DbTablePrincipalAttrs,
  CustomRoleResourceAttrs,
  EnvironmentResourceAttrs,
  DashboardResourceAttrs,
  QueryAction,
  ApprovalAction,
  DatabaseConnectionAction,
  AuditLogAction,
  DbTableAction,
  CustomRoleAction,
  EnvironmentAction,
  DashboardAction,
  DecisionMap,
  DbTableDecision,
} from './types'


function buildPrincipal(p: CerbosPrincipal) {
  return {
    id: p.userId,
    roles: [p.platformRole],
    attr: { org_id: p.orgId },
  }
}

async function check<T extends string>(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resourceKind: string,
  resourceId: string,
  resourceAttrs: Record<string, string | null>,
  actions: T[],
): Promise<DecisionMap<T>> {
  const result = await client.checkResources({
    principal: buildPrincipal(principal),
    resources: [
      {
        resource: { kind: resourceKind, id: resourceId, attr: resourceAttrs },
        actions: actions as string[],
      },
    ],
  })

  return Object.fromEntries(
    actions.map((action) => [
      action,
      result.isAllowed({ resource: { kind: resourceKind, id: resourceId }, action }),
    ]),
  ) as DecisionMap<T>
}


export async function checkQuery(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: QueryResourceAttrs,
  actions: QueryAction[],
): Promise<DecisionMap<QueryAction>> {
  return check(client, principal, 'query', resource.id, {
    org_id: resource.orgId,
    risk_level: resource.riskLevel,
    environment: resource.environment,
    submitted_by: resource.submittedBy,
  }, actions)
}

export async function checkApproval(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: ApprovalResourceAttrs,
  actions: ApprovalAction[],
): Promise<DecisionMap<ApprovalAction>> {
  return check(client, principal, 'approval_request', resource.id, {
    org_id: resource.orgId,
    submitted_by: resource.submittedBy,
    status: resource.status,
  }, actions)
}
export async function filterReadableApprovals(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resources: ApprovalResourceAttrs[],
): Promise<Set<string>> {
  if (resources.length === 0) return new Set()

  const result = await client.checkResources({
    principal: buildPrincipal(principal),
    resources: resources.map((r) => ({
      resource: { kind: 'approval_request', id: r.id, attr: { org_id: r.orgId, submitted_by: r.submittedBy, status: r.status } },
      actions: ['read'],
    })),
  })

  const readable = new Set<string>()
  for (const r of resources) {
    if (result.isAllowed({ resource: { kind: 'approval_request', id: r.id }, action: 'read' })) readable.add(r.id)
  }
  return readable
}

export async function checkDatabaseConnection(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: DatabaseConnectionResourceAttrs,
  actions: DatabaseConnectionAction[],
): Promise<DecisionMap<DatabaseConnectionAction>> {
  return check(client, principal, 'database_connection', resource.id, {
    org_id: resource.orgId,
  }, actions)
}

export async function checkAuditLog(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: AuditLogResourceAttrs,
  actions: AuditLogAction[],
): Promise<DecisionMap<AuditLogAction>> {
  return check(client, principal, 'audit_log', resource.id, {
    org_id: resource.orgId,
    actor_id: resource.actorId,
  }, actions)
}
export async function filterReadableAuditLogs(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resources: AuditLogResourceAttrs[],
): Promise<Set<string>> {
  if (resources.length === 0) return new Set()

  const result = await client.checkResources({
    principal: buildPrincipal(principal),
    resources: resources.map((r) => ({
      resource: { kind: 'audit_log', id: r.id, attr: { org_id: r.orgId, actor_id: r.actorId } },
      actions: ['read'],
    })),
  })

  const readable = new Set<string>()
  for (const r of resources) {
    if (result.isAllowed({ resource: { kind: 'audit_log', id: r.id }, action: 'read' })) readable.add(r.id)
  }
  return readable
}

export async function checkCustomRole(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: CustomRoleResourceAttrs,
  actions: CustomRoleAction[],
): Promise<DecisionMap<CustomRoleAction>> {
  return check(client, principal, 'custom_role', resource.id, {
    org_id: resource.orgId,
  }, actions)
}

export async function checkEnvironment(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: EnvironmentResourceAttrs,
  actions: EnvironmentAction[],
): Promise<DecisionMap<EnvironmentAction>> {
  return check(client, principal, 'environment', resource.id, {
    org_id: resource.orgId,
  }, actions)
}

export async function checkDashboard(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: DashboardResourceAttrs,
  actions: DashboardAction[],
): Promise<DecisionMap<DashboardAction>> {
  return check(client, principal, 'dashboard', 'workspace', {
    org_id: resource.orgId,
  }, actions)
}

export async function checkDbTable(
  client: CerbosClient,
  principal: CerbosPrincipal,
  dbAttrs: DbTablePrincipalAttrs,
  resource: DbTableResourceAttrs,
  actions: DbTableAction[],
): Promise<DbTableDecision> {
  const result = await client.checkResources({
    principal: {
      id: principal.userId,
      roles: [principal.platformRole],
      attr: {
        org_id: principal.orgId,
        table_scope: dbAttrs.tableScope,
        capabilities: dbAttrs.capabilities,
        row_filter: dbAttrs.rowFilter,
        masked_columns: dbAttrs.maskedColumns,
      },
    },
    resources: [
      {
        resource: { kind: 'db_table', id: resource.table, attr: { org_id: resource.orgId } },
        actions,
      },
    ],
  })

  const allowed = Object.fromEntries(
    actions.map((action) => [
      action,
      result.isAllowed({ resource: { kind: 'db_table', id: resource.table }, action }),
    ]),
  ) as DecisionMap<DbTableAction>

  const resourceResult = result.findResult({ kind: 'db_table', id: resource.table })
  const output = resourceResult?.outputs[0]?.value as
    | { rowFilter?: string | null; maskedColumns?: string[] }
    | undefined

  return {
    allowed,
    rowFilter: output?.rowFilter ?? null,
    maskedColumns: output?.maskedColumns ?? [],
  }
}


export async function canSubmitQuery(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: QueryResourceAttrs,
): Promise<boolean> {
  const d = await checkQuery(client, principal, resource, ['submit'])
  return d.submit
}

export async function canApproveQuery(
  client: CerbosClient,
  principal: CerbosPrincipal,
  resource: QueryResourceAttrs,
): Promise<boolean> {
  const d = await checkQuery(client, principal, resource, ['approve'])
  return d.approve
}
