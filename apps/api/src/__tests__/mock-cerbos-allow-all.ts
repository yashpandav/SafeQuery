import type { CheckResourcesRequest } from '@cerbos/core'
import type { CerbosClient, CerbosCheckResourceResult } from '@repo/policy-client'

// For tests that exercise apps/api's own authorization gating (e.g.
// "rejects when X"), not Cerbos's db_table policy logic (already covered by
// packages/sql-validator's 65 tests). Allows any action as long as the
// resource and principal org_id attributes match.
export function createAllowAllCerbosClient(orgId: string): CerbosClient {
  return {
    async checkResources(req: CheckResourcesRequest) {
      const principalOrgId = req.principal.attr?.['org_id']
      const results = req.resources.map(({ resource, actions }) => {
        const allowed = resource.attr?.['org_id'] === principalOrgId && principalOrgId === orgId
        const actionsMap: Record<string, boolean> = {}
        for (const action of actions) actionsMap[action] = allowed
        return {
          resourceId: resource.id,
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
          const match = results.find((r) => r.resourceId === resource.id)
          return match ? { outputs: [] } : undefined
        },
      }
    },
  }
}
