import type { CerbosClient } from './client'
import type {
  CerbosPrincipal,
  QueryResourceAttrs,
  ApprovalResourceAttrs,
  DatabaseConnectionResourceAttrs,
  AuditLogResourceAttrs,
  QueryAction,
  ApprovalAction,
  DatabaseConnectionAction,
  AuditLogAction,
  DecisionMap,
} from './types'

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildPrincipal(p: CerbosPrincipal) {
  return {
    id: p.userId,
    roles: [p.platformRole],
    attributes: { org_id: p.orgId },
  }
}

// Calls checkResources for a single resource + action set and returns a typed
// decision map.  Using a single checkResources call per resource keeps the
// function simple; batch calls can be composed at the callsite when needed.
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
        resource: { kind: resourceKind, id: resourceId, attributes: resourceAttrs },
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

// ── Public check functions ────────────────────────────────────────────────────

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

// ── Convenience single-action helpers ────────────────────────────────────────

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
