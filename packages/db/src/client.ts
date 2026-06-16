import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index'
import * as relations from './relations'

// createDbClient is called once per app process (apps/api, apps/tre-executor, etc.)
// and is NOT called inside the TRE for customer DB connections — those use raw pg clients.
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

// Sets the app.current_org_id Postgres session variable so RLS policies evaluate correctly.
// Must be called at the start of every request handler that accesses RLS-protected tables.
export function withOrgContext(orgId: string): string {
  return `SET LOCAL app.current_org_id = '${orgId.replace(/'/g, "''")}'`
}
