import { z } from 'zod'

export const RateLimitPolicySchema = z.object({
  enabled: z.boolean(),
  queriesPerMinutePerUser: z.number().int().positive(),
  aiCallsPerDayPerOrg: z.number().int().positive(),
})
export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>

export const UpdateRateLimitPolicySchema = RateLimitPolicySchema
export type UpdateRateLimitPolicy = z.infer<typeof UpdateRateLimitPolicySchema>
export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = {
  enabled: true,
  queriesPerMinutePerUser: 20,
  aiCallsPerDayPerOrg: 500,
}
