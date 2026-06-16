'use client'

import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../trpc/client'

export function ClientGreeting() {
  const trpc = useTRPC()
  const health = useQuery(trpc.health.check.queryOptions())

  if (health.isPending) return <div>Connecting to SafeQuery API…</div>
  if (health.isError) return <div>API unreachable — is apps/api running?</div>

  return (
    <div>
      <strong>SafeQuery API</strong> — {health.data.status} ({health.data.timestamp})
    </div>
  )
}
