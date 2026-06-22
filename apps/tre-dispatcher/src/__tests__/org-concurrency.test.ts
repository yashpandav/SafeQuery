import { describe, it, expect } from 'vitest'
import { shouldDelayForOrgConcurrency, type ActiveJobLike, type ActiveJobsLookup } from '../lib/org-concurrency'

function lookupReturning(jobs: ActiveJobLike[]): ActiveJobsLookup {
  return { getActiveJobs: async () => jobs }
}

describe('shouldDelayForOrgConcurrency', () => {
  it('allows the job when the org is under the limit', async () => {
    const lookup = lookupReturning([
      { id: 'current', data: { orgId: 'org-a' } },
      { id: 'other-1', data: { orgId: 'org-a' } },
    ])
    const result = await shouldDelayForOrgConcurrency(lookup, 'current', 'org-a', 3)
    expect(result).toBe(false)
  })

  it('delays the job once the org is at the limit', async () => {
    const lookup = lookupReturning([
      { id: 'current', data: { orgId: 'org-a' } },
      { id: 'other-1', data: { orgId: 'org-a' } },
      { id: 'other-2', data: { orgId: 'org-a' } },
      { id: 'other-3', data: { orgId: 'org-a' } },
    ])
    const result = await shouldDelayForOrgConcurrency(lookup, 'current', 'org-a', 3)
    expect(result).toBe(true)
  })

  it('excludes the current job itself from the count', async () => {
    const lookup = lookupReturning([{ id: 'current', data: { orgId: 'org-a' } }])
    const result = await shouldDelayForOrgConcurrency(lookup, 'current', 'org-a', 1)
    expect(result).toBe(false)
  })

  it('does not count jobs belonging to a different org', async () => {
    const lookup = lookupReturning([
      { id: 'current', data: { orgId: 'org-a' } },
      { id: 'busy-1', data: { orgId: 'org-b' } },
      { id: 'busy-2', data: { orgId: 'org-b' } },
      { id: 'busy-3', data: { orgId: 'org-b' } },
    ])
    const result = await shouldDelayForOrgConcurrency(lookup, 'current', 'org-a', 1)
    expect(result).toBe(false)
  })
})
