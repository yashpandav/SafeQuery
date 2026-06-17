import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index'
import * as relations from './relations'

export function createDbClient(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  return drizzle(pool, { schema: { ...schema, ...relations } })
}

export type DbClient = ReturnType<typeof createDbClient>

export function withOrgContext(orgId: string): string {
  return `SET LOCAL app.current_org_id = '${orgId.replace(/'/g, "''")}'`
}
