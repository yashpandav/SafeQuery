import { HTTP } from '@cerbos/http'

export function createCerbosClient(cerbosUrl: string): HTTP {
  return new HTTP(cerbosUrl)
}

export type CerbosClient = HTTP
