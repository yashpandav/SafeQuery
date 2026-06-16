import { createCerbosClient } from '@repo/policy-client'
import { env } from '../env'

export const cerbos = createCerbosClient(env.CERBOS_URL)
