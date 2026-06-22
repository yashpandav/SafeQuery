import './env' // validate env vars before anything else
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { appRouter } from './trpc/routers/_app'
import { createTRPCContext } from './trpc/init'
import { env } from './env'
import { logger } from './logger'

const app = express()

app.use(helmet())
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
app.use(express.json({ limit: '256kb' })) // prompts are capped at 2000 chars; no need for apps/api's 1mb

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req, res }) => createTRPCContext({ req, res }),
    onError({ error, path }) {
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        logger.error({ path: path ?? 'unknown', err: error.message }, 'tRPC internal error')
      }
    },
  }),
)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, generationModel: env.AI_MODEL, screeningModel: env.AI_SCREEN_MODEL }, 'SafeQuery AI service running')
})
