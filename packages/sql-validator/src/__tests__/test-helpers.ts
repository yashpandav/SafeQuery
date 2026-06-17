import type { CerbosClient } from '@repo/policy-client'
import type { CustomRoleConfig } from '@repo/types'

export function createMockCerbosClient(orgId: string, customRole: CustomRoleConfig): CerbosClient {
  return {
    async checkResources(req: {
      principal: { attributes: Record<string, unknown> }
      resources: { resource: { kind: string; id: string; attributes: Record<string, unknown> }; actions: string[] }[]
    }) {
      const principalOrgId = req.principal.attributes['org_id']
      const results = req.resources.map(({ resource, actions }) => {
        const resourceOrgId = resource.attributes['org_id']
        const orgMatches = resourceOrgId === principalOrgId && principalOrgId === orgId
        const tableInScope = customRole.allowedTables.includes(resource.id)

        const actionsMap: Record<string, 'EFFECT_ALLOW' | 'EFFECT_DENY'> = {}
        const outputs: { action: string; source: string; value: unknown }[] = []
        for (const action of actions) {
          const capabilityMap: Record<string, boolean> = {
            select: customRole.allowedActions.includes('SELECT'),
            insert: customRole.allowedActions.includes('INSERT'),
            update: customRole.allowedActions.includes('UPDATE'),
            delete: customRole.allowedActions.includes('DELETE'),
          }
          const allowed = orgMatches && tableInScope && Boolean(capabilityMap[action])
          actionsMap[action] = allowed ? 'EFFECT_ALLOW' : 'EFFECT_DENY'
          if (allowed) {
            outputs.push({
              action,
              source: 'mock',
              value: { rowFilter: customRole.rowFilters[resource.id] ?? null, maskedColumns: [] },
            })
          }
        }

        return {
          resource: { kind: resource.kind, id: resource.id },
          actions: actionsMap,
          outputs,
          isAllowed(action: string) {
            return actionsMap[action] === 'EFFECT_ALLOW'
          },
        }
      })

      return {
        results,
        isAllowed({ resource, action }: { resource: { kind: string; id: string }; action: string }) {
          return results.find((r) => r.resource.id === resource.id)?.isAllowed(action)
        },
        findResult(resource: { kind: string; id: string }) {
          return results.find((r) => r.resource.id === resource.id)
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as CerbosClient
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
