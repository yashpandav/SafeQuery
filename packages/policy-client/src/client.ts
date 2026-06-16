import { HTTP } from '@cerbos/http'

// createCerbosClient is called once at API startup — the HTTP client is stateless
// and safe to share across requests.
export function createCerbosClient(cerbosUrl: string): HTTP {
  return new HTTP(cerbosUrl)
}

export type CerbosClient = HTTP
