
import { eq, and } from 'drizzle-orm'
import { createDbClient } from '../src/client'
import { organizations, organizationMembers, customRoles, users, environments } from '../src/schema/index'
import type { CustomRoleConfig, EnvironmentType } from '@repo/types'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is required')
  process.exit(1)
}

const ANALYST_EMAIL = 'analyst@safequery.dev'
const REVIEWER_EMAIL = 'reviewer@safequery.dev'
const ORG_SLUG = 'demo-org'

async function ensureEnvironment(
  db: ReturnType<typeof createDbClient>,
  orgId: string,
  name: string,
  type: EnvironmentType,
) {
  const existing = await db.query.environments.findFirst({ where: and(eq(environments.orgId, orgId), eq(environments.type, type)) })
  if (existing) {
    console.log(`ℹ️   Environment ${existing.id} (${type}) already exists`)
    return existing
  }
  const [created] = await db.insert(environments).values({ orgId, name, type }).returning()
  console.log(`✅  Created environment ${created!.id} (${type})`)
  return created!
}

async function main() {
  const db = createDbClient(DATABASE_URL!)

  const analyst = await db.query.users.findFirst({ where: eq(users.email, ANALYST_EMAIL) })
  if (!analyst) {
    console.error(`❌  No user found for ${ANALYST_EMAIL} — call auth.exchangeToken at least once first`)
    process.exit(1)
  }
  const reviewer = await db.query.users.findFirst({ where: eq(users.email, REVIEWER_EMAIL) })
  if (!reviewer) {
    console.error(`❌  No user found for ${REVIEWER_EMAIL} — call auth.exchangeToken at least once first`)
    process.exit(1)
  }

  let org = await db.query.organizations.findFirst({ where: eq(organizations.slug, ORG_SLUG) })
  if (!org) {
    const [created] = await db.insert(organizations).values({ name: 'Demo Org', slug: ORG_SLUG }).returning()
    org = created!
    console.log(`✅  Created organization ${org.id} (${org.slug})`)
  } else {
    console.log(`ℹ️   Organization ${org.id} (${org.slug}) already exists`)
  }
  const devEnv = await ensureEnvironment(db, org.id, 'Development', 'development')
  const prodEnv = await ensureEnvironment(db, org.id, 'Production', 'production')

  const demoRoleConfig: CustomRoleConfig = {
    allowedTables: ['customers', 'orders'],
    allowedColumns: {},
    allowedActions: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    rowFilters: {},
    rowCap: 1000,
  }

  let customRole = await db.query.customRoles.findFirst({ where: eq(customRoles.orgId, org.id) })
  if (!customRole) {
    const [created] = await db
      .insert(customRoles)
      .values({ orgId: org.id, name: 'demo-analyst', description: 'Full CRUD on customers/orders for local testing', config: demoRoleConfig })
      .returning()
    customRole = created!
    console.log(`✅  Created custom role ${customRole.id} (${customRole.name})`)
  } else {
    console.log(`ℹ️   Custom role ${customRole.id} (${customRole.name}) already exists`)
  }

  const existingAnalystMembership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, analyst.id),
  })
  if (!existingAnalystMembership) {
    await db.insert(organizationMembers).values({
      orgId: org.id,
      userId: analyst.id,
      platformRole: 'owner', // owner so this same user can also create db connections
      customRoleId: customRole.id,
    })
    console.log(`✅  Added ${ANALYST_EMAIL} as owner with the demo-analyst custom role`)
  } else {
    console.log(`ℹ️   ${ANALYST_EMAIL} is already a member`)
  }

  const existingReviewerMembership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, reviewer.id),
  })
  if (!existingReviewerMembership) {
    await db.insert(organizationMembers).values({
      orgId: org.id,
      userId: reviewer.id,
      platformRole: 'reviewer',
      customRoleId: null, // reviewers approve/reject — they don't submit queries themselves
    })
    console.log(`✅  Added ${REVIEWER_EMAIL} as reviewer`)
  } else {
    console.log(`ℹ️   ${REVIEWER_EMAIL} is already a member`)
  }

  console.log('')
  console.log('Values for the Postman environment:')
  console.log(`  orgId:            ${org.id}`)
  console.log(`  devEnvironmentId:  ${devEnv.id}`)
  console.log(`  prodEnvironmentId: ${prodEnv.id}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌  Seed failed:', err)
  process.exit(1)
})
