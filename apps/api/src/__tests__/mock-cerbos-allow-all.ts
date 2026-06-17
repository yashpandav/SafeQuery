import type { CerbosClient } from '@repo/policy-client'
export function createAllowAllCerbosClient(orgId: string): CerbosClient {
  return {
    async checkResources(req: {
      principal: { attributes: Record<string, unknown> }
      resources: { resource: { kind: string; id: string; attributes: Record<string, unknown> }; actions: string[] }[]
    }) {
      const principalOrgId = req.principal.attributes['org_id']
      const results = req.resources.map(({ resource, actions }) => {
        const allowed = resource.attributes['org_id'] === principalOrgId && principalOrgId === orgId
        const actionsMap: Record<string, 'EFFECT_ALLOW' | 'EFFECT_DENY'> = {}
        for (const action of actions) actionsMap[action] = allowed ? 'EFFECT_ALLOW' : 'EFFECT_DENY'
        return {
          resource: { kind: resource.kind, id: resource.id },
          actions: actionsMap,
          outputs: [],
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
  } as any as CerbosClient
}
