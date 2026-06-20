import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'
import type { CustomRoleConfig } from '@repo/types'

// Mirrors packages/sql-validator's own test mock — replicates db_table.yaml's
// decision logic (org match, table in scope, action in capabilities) so
// sql-validator behaves realistically when called from these orchestration
// tests, without needing a live Cerbos server. sql-validator's own 65 tests
// already cover its authorization logic in depth; this just needs to be
// faithful enough that apps/api's branching logic gets exercised correctly.
export function createMockCerbosClient(orgId: string, customRole: CustomRoleConfig): CerbosClient {
  return {
    async checkResources(req: CheckResourcesRequest) {
      const principalOrgId = req.principal.attr?.['org_id']
      const results = req.resources.map(({ resource, actions }) => {
        const orgMatches = resource.attr?.['org_id'] === principalOrgId && principalOrgId === orgId
        const tableInScope = customRole.allowedTables.includes(resource.id)
        const capabilityMap: Record<string, boolean> = {
          select: customRole.allowedActions.includes('SELECT'),
          insert: customRole.allowedActions.includes('INSERT'),
          update: customRole.allowedActions.includes('UPDATE'),
          delete: customRole.allowedActions.includes('DELETE'),
        }

        const actionsMap: Record<string, boolean> = {}
        const outputs: { value: unknown }[] = []
        for (const action of actions) {
          const allowed = orgMatches && tableInScope && Boolean(capabilityMap[action])
          actionsMap[action] = allowed
          if (allowed) {
            const maskedColumns = req.principal.attr?.['masked_columns']
            outputs.push({ value: { rowFilter: customRole.rowFilters[resource.id] ?? null, maskedColumns: Array.isArray(maskedColumns) ? maskedColumns : [] } })
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
