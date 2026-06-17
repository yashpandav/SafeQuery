import './env' // validate env vars before anything else
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { appRouter } from './trpc/routers/_app'
import { createTRPCContext } from './trpc/init'
import { env } from './env'

const app = express()

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req, res }) => createTRPCContext({ req, res }),
    onError({ error, path }) {
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        console.error(`[tRPC] Internal error on ${path ?? 'unknown'}:`, error.message)
      }
    },
  }),
)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(env.PORT, () => {
  console.log(`SafeQuery API running on http://localhost:${env.PORT}`)
  console.log(`  tRPC endpoint: http://localhost:${env.PORT}/trpc`)
  console.log(`  Environment:   ${env.NODE_ENV}`)
})
