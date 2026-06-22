export interface ActiveJobLike {
  id?: string
  data: { orgId: string }
}

export interface ActiveJobsLookup {
  getActiveJobs(): Promise<ActiveJobLike[]>
}

export async function shouldDelayForOrgConcurrency(
  lookup: ActiveJobsLookup,
  currentJobId: string | undefined,
  orgId: string,
  maxConcurrentPerOrg: number,
): Promise<boolean> {
  const activeJobs = await lookup.getActiveJobs()
  const activeCountForOrg = activeJobs.filter((job) => job.id !== currentJobId && job.data.orgId === orgId).length
  return activeCountForOrg >= maxConcurrentPerOrg
}
