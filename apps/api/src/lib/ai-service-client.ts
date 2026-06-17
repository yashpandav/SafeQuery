import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@repo/ai-service/router'
import { signServiceToken } from '@repo/auth'
import { env } from '../env'
import type { AiServiceClient } from './query-pipeline'
const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.AI_SERVICE_URL}/trpc`,
      headers: async () => {
        const token = await signServiceToken({ service: 'api' }, env.SERVICE_PRIVATE_KEY)
        return { authorization: `Bearer ${token}` }
      },
    }),
  ],
})
export const aiServiceClient: AiServiceClient = {
  ai: {
    generate: (input) => trpcClient.ai.generate.mutate(input),
  },
}
