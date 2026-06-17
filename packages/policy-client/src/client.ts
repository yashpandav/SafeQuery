import { HTTP } from '@cerbos/http'
import type { CheckResourcesRequest } from '@cerbos/core'

// Narrowed to exactly what packages/policy-client's check functions read
// from a response — not the full CheckResourcesResponse/CheckResourcesResult
// classes (many more methods this codebase never calls). This means test
// doubles can satisfy these with a plain object literal, no `any`/`unknown`
// casts or eslint-disable comments anywhere; the real HTTP client's response
// structurally satisfies them for free (it's a strict superset).
export interface CerbosCheckResourceResult {
  outputs: { value: unknown }[]
}
export interface CerbosCheckResponse {
  isAllowed(check: { resource: { kind: string; id: string }; action: string }): boolean | undefined
  findResult(resource: { kind: string; id: string }): CerbosCheckResourceResult | undefined
}

// Narrowed to the one method this package actually calls, rather than the
// full HTTP class (which has many more methods this codebase never uses).
export interface CerbosClient {
  checkResources(request: CheckResourcesRequest): Promise<CerbosCheckResponse>
}

// createCerbosClient is called once at API startup — the HTTP client is stateless
// and safe to share across requests.
export function createCerbosClient(cerbosUrl: string): CerbosClient {
  return new HTTP(cerbosUrl)
}
