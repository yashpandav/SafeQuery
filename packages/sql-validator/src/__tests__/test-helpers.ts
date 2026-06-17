import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'
import type { CustomRoleConfig } from '@repo/types'

// Replicates db_table.yaml's decision logic exactly (org match, table in scope,
// action in capabilities; echoes back the row filter for the checked table) so
// these unit tests exercise the validator's USE of a Cerbos decision without a
// live Cerbos server. The policy file itself needs its own Cerbos policy tests
// (Cerbos's own test runner) — that is a separate concern from this package.
export function createMockCerbosClient(orgId: string, customRole: CustomRoleConfig): CerbosClient {
  return {
    async checkResources(req: CheckResourcesRequest) {
      const principalOrgId = req.principal.attr?.['org_id']
      const results = req.resources.map(({ resource, actions }) => {
        const resourceOrgId = resource.attr?.['org_id']
        const orgMatches = resourceOrgId === principalOrgId && principalOrgId === orgId
        const tableInScope = customRole.allowedTables.includes(resource.id)

        const actionsMap: Record<string, boolean> = {}
        const outputs: { value: unknown }[] = []
        for (const action of actions) {
          const capabilityMap: Record<string, boolean> = {
            select: customRole.allowedActions.includes('SELECT'),
            insert: customRole.allowedActions.includes('INSERT'),
            update: customRole.allowedActions.includes('UPDATE'),
            delete: customRole.allowedActions.includes('DELETE'),
          }
          const allowed = orgMatches && tableInScope && Boolean(capabilityMap[action])
          actionsMap[action] = allowed
          if (allowed) {
            outputs.push({ value: { rowFilter: customRole.rowFilters[resource.id] ?? null, maskedColumns: [] } })
          }
        }

        return {
          resourceId: resource.id,
          outputs,
          isAllowed(action: string) {
            return actionsMap[action] ?? false
          },
        }
      })

      return {
        isAllowed({ resource, action }: { resource: { kind: string; id: string }; action: string }) {
          return results.find((r) => r.resourceId === resource.id)?.isAllowed(action)
        },
        findResult(resource: { kind: string; id: string }): CerbosCheckResourceResult | undefined {
          return results.find((r) => r.resourceId === resource.id)
        },
      }
    },
  }
}

export const FULL_ACCESS_ROLE: CustomRoleConfig = {
  allowedTables: ['customers', 'orders'],
  allowedColumns: {},
  allowedActions: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  rowFilters: { customers: "org_id = 'org-1'", orders: "org_id = 'org-1'" },
  rowCap: 1000,
}

export const READ_ONLY_ROLE: CustomRoleConfig = {
  allowedTables: ['customers'],
  allowedColumns: {},
  allowedActions: ['SELECT'],
  rowFilters: { customers: "org_id = 'org-1'" },
  rowCap: 1000,
}
