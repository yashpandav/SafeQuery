import { createOpenAI } from '@ai-sdk/openai'
import { env } from '../env'
const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })

export const generationModel = openai(env.AI_MODEL)
export const screeningModel = openai(env.AI_SCREEN_MODEL)
