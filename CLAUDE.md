# SafeQuery — Claude Code Project Guide

## What This Is

SafeQuery is an **Enterprise AI Database Governance Platform** — a control plane that sits between an LLM and a real database. It enforces policy, validates AI-generated SQL as untrusted input, routes by risk, executes in an isolated Trusted Runtime Environment (TRE), masks PII, and records everything in a tamper-evident hash-chain audit log.

**The core problem it solves:** Employees paste AI-generated SQL directly into production databases with no validation, no permission checks, no approval step, and no audit trail. SafeQuery replaces that workflow.

**Full specifications live in `Docs/`:**
- `Docs/01_PRODUCT_REQUIREMENTS.md` — PRD, user stories, FR list, success metrics
- `Docs/02_TECHNICAL_ARCHITECTURE.md` — TAD, system diagram, data model, ADRs
- `Docs/03_SECURITY_AND_ACCESS.md` — identity/auth/authz, defense-in-depth, threat model
- `Docs/04_FEATURE_TICKET_LIST.md` — engineering backlog, epics, phases P0–P5
- `Docs/PROOF_OF_CONCEPT.md` — complete reference spec (canonical truth)

---

## Monorepo Structure (Actual Current State)

```
my-turborepo/
├── apps/
│   ├── web/              # Next.js 16 + Tailwind 4 — chat/approvals UI wired to apps/api ✅ BUILT
│   ├── api/              # Express + tRPC — core API server ✅ BUILT
│   ├── ai-service/       # Vercel AI SDK — SQL generation ✅ BUILT
│   ├── tre-dispatcher/   # BullMQ worker process — routes jobs to tre-executor ✅ BUILT
│   └── tre-executor/     # The only component that touches customer DBs ✅ BUILT
├── packages/
│   ├── ui/               # Shared React components ✅ EXISTS
│   ├── types/            # Shared Zod schemas + TypeScript types ✅ BUILT
│   ├── auth/             # Keycloak OIDC + PASETO v3.local + v4.public helpers ✅ BUILT
│   ├── db/               # Drizzle ORM schema + RLS + migrations ✅ BUILT
│   ├── sql-validator/    # AST parsing, Cerbos decisions, row-filter injection ✅ BUILT
│   ├── policy-client/    # Cerbos HTTP client wrapper ✅ BUILT
│   ├── audit/            # Hash-chain audit writer + verify-integrity ✅ BUILT
│   ├── secrets/          # AES-256-GCM envelope encryption for DB credentials ✅ BUILT
│   ├── queue/            # Shared BullMQ job contracts (api ↔ dispatcher ↔ executor) ✅ BUILT
│   ├── rate-limit/       # rate-limiter-flexible wrappers (NOT YET CREATED)
│   ├── eslint-config/    # Shared ESLint configs ✅ EXISTS
│   └── typescript-config/ # Shared TS configs ✅ EXISTS
├── infra/
│   ├── docker/           # docker-compose.yml + Cerbos policies + Keycloak realm ✅ BUILT
│   ├── k8s/              # Helm charts / manifests (Phase 4)
│   └── terraform/        # IaC (Phase 5)
├── Docs/                 # Full specifications (READ THESE)
├── CLAUDE.md             # This file
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript 5.9, Tailwind CSS, tRPC 11, TanStack Query 5, Zod 4 |
| Backend API | Express, TypeScript 5.9, tRPC 11, Zod 4 |
| Database (app) | PostgreSQL 16 + Drizzle ORM 0.44, Row-Level Security on `org_id` |
| Identity | Keycloak 24 (OIDC, off-the-shelf container) |
| Sessions/Tokens | PASETO **v3.local** (sessions, AES-256-CTR+HMAC-SHA384) + **v4.public** (service-to-service, Ed25519) |
| Authorization | Cerbos 0.28 (HTTP, attribute-based policy decision point) |
| AI | Vercel AI SDK 6 (`generateText` + `Output.object`, not the deprecated `generateObject`), OpenAI provider, structured outputs via Zod |
| SQL Processing | node-sql-parser (AST), Cerbos decisions, row-filter injection |
| Job Queue | BullMQ 5 + Redis 7 (apps/api producer → apps/tre-dispatcher consumer) |
| DB Execution | pg 8 + pg-cursor (row caps); single-process worker pool (P1) → containers/k8s (P3+) |
| Secret Mgmt | AES-256-GCM two-layer envelope encryption (P1, `packages/secrets`) → HashiCorp Vault dynamic secrets (P3) |
| Audit | SHA-256 hash chain (append-only, verify-integrity endpoint) |
| Rate Limiting | rate-limiter-flexible (per-user/org), Cloudflare edge (P4) |
| Observability | Pino, OpenTelemetry, Prometheus/Grafana, Loki, Sentry |
| Package Manager | pnpm 9 |
| Build System | Turborepo 2.9 |

---

## Core Architectural Invariants (Never Violate These)

1. **Core API never touches customer databases** — only enqueues jobs; TRE is the only DB-facing component.
2. **AI output is untrusted input** — always parse with AST, run Cerbos decisions, and rewrite before execution. Never execute raw LLM SQL.
3. **Permissions resolved live** — never cache in tokens; every request calls Cerbos for a fresh decision.
4. **Identity / auth / authorization are three separate tools:** Keycloak = who you are, PASETO = proof you authenticated, Cerbos = what you're allowed to do.
5. **Custom roles are application data** — stored as DB rows, configurable by org admins without redeployment.
6. **Dry-run before commit** — EXPLAIN for reads, transactional ROLLBACK for writes (exact preview), COMMIT is source of truth.
7. **Append-only audit** — every state change is logged with hash chain; tampering must be detectable.

---

## Query Risk Pipeline (The Core Feature)

```
Natural language question
  → [Prompt firewall: injection screen]
  → [AI: structured SQL + explanation + risk hint]
  → [Validation: AST parse, Cerbos per-table/action, forbidden-pattern check, row-filter injection]
  → [Risk classification: SAFE | WARNING | CRITICAL | SECURITY_INCIDENT]
  → Branch:
      SAFE            → auto-execute on warm read pool
      WARNING         → user acknowledgment → execute
      CRITICAL        → dry-run simulation shown to Reviewer → approve/reject → ephemeral write executor
      SECURITY_INCIDENT → hard reject, no approval path
  → [TRE execution: isolated, row-capped, credential-isolated]
  → [PII masking before results leave TRE boundary]
  → [Hash-chain audit log]
  → Result returned to user
```

---

## Execution Two-Tier Strategy

| Tier | Use Case | Connection Model | Isolation |
|------|----------|-----------------|-----------|
| Warm Read Pool | SAFE / WARNING reads | Long-lived, renewed leases | Network-isolated, read-only role |
| Ephemeral Write Executor | CRITICAL writes (after approval) | Single-use, fresh per write | Max isolation, separate process/container |

---

## Platform Roles

| Role | Key Capabilities |
|------|----------------|
| Owner | Full platform control, billing, delete org |
| Admin | Manage members, DB connections, environments, custom roles |
| Reviewer | Approve/reject CRITICAL queries, view audit logs |
| Analyst | Submit queries (within their custom-role permissions) |
| Viewer | Read-only access to approved query results |

Custom roles (defined per org in DB) specify: allowed tables, allowed columns, allowed actions (SELECT/INSERT/UPDATE/DELETE), row filters, row caps.

---

## Database Schema (12 Core Tables)

`organizations`, `users`, `custom_roles`, `environments`, `database_connections`, `schema_snapshots`, `policies`, `query_logs`, `approval_requests`, `audit_logs`, `invitations`, `organization_members`

- All tenant-scoped tables have `org_id` with PostgreSQL RLS (`current_setting('app.current_org_id')::uuid`)
- `users` intentionally has NO RLS — resolved before org context is set
- `organization_members` has a composite primary key `(org_id, user_id)` plus a nullable `custom_role_id`
  FK to `custom_roles` (`ON DELETE SET NULL`) — null means that member has no query.submit capability
  for this org (e.g. an Owner/Admin who only manages the platform)
- `audit_logs` has `prev_hash` + `hash` columns forming a SHA-256 hash chain
- `database_connections.encrypted_credentials` holds a `packages/secrets` envelope (JSON: ciphertext +
  IV + auth tag, twice — once for the credentials, once for the per-row data key wrapped by the master
  key). `apps/api` never decrypts it; only `apps/tre-executor` holds `CREDENTIAL_MASTER_KEY`.

RLS policies live in `packages/db/src/rls-policies.sql` (run after `drizzle-kit migrate`).
**No live database has been migrated yet in this environment** (Docker wasn't running when the schema
last changed) — `packages/db/drizzle/0000_*.sql` is generated and ready but unapplied. Run
`pnpm --filter @repo/db db:migrate` once Postgres is up, then apply `rls-policies.sql`.

---

## Packages Architecture

### `packages/types`
Shared Zod schemas and TypeScript types. All schemas used at system boundaries.
Key exports: `RiskLevel`, `PlatformRole`, `AuditAction`, `WriteAuditLog`, `QueryLog`, etc.

### `packages/db`
Drizzle ORM schema, relations, DB client, RLS SQL.
Key exports: `createDbClient()`, `withOrgContext()`, `DbClient`, all table definitions.
Run `pnpm --filter @repo/db db:generate` then `db:migrate` after schema changes.

### `packages/auth`
PASETO v3.local session tokens + PASETO v4.public service tokens + Keycloak OIDC JWT verification.
Key exports: `signSession()`, `verifySession()`, `verifyKeycloakToken()`, `extractBearerToken()`,
`generateServiceKeypairBase64()`, `signServiceToken()`, `verifyServiceToken()`.
**Note on v3 vs v4.local:** sessions use v3.local (not v4.local) — the `paseto` npm package does not
implement XChaCha20 (v4.local). It DOES implement v4.public (Ed25519 sign/verify), which is what
service-to-service calls (`api` → `ai-service`) use — signed with a private key, verified with a
public key, no shared secret. Keypairs are Ed25519, base64-encoded SPKI/PKCS8 PEM, generated via
`generateServiceKeypairBase64()`. 5 unit tests (`pnpm --filter @repo/auth test`) cover sign/verify
round-trip, wrong-keypair rejection, expiry, and tampering.

### `packages/policy-client`
Cerbos HTTP client wrapper with typed check functions per resource.
Key exports: `createCerbosClient()`, `checkQuery()`, `checkApproval()`, `checkDatabaseConnection()`, `checkAuditLog()`, `canSubmitQuery()`, `canApproveQuery()`.
`CerbosClient`/`CerbosCheckResponse`/`CerbosCheckResourceResult` are narrowed interfaces (just `checkResources()`,
`isAllowed()`, `findResult()` → `outputs`) instead of `@cerbos/http`'s full `HTTP`/`CheckResourcesResponse` classes —
the real client structurally satisfies them for free, and test doubles can be plain object literals with zero
`any`/`unknown` casts or `eslint-disable` comments. Request-building uses `attr` (not the deprecated `attributes`
alias) on `Principal`/`Resource`, matching `@cerbos/core`'s current API guidance — Cerbos policy CEL always reads
`request.principal.attr.*`/`request.resource.attr.*` regardless of which SDK field name was used to send it, so
this was a modernization, not a bug fix.

### `packages/audit`
Hash-chain audit log writer and integrity verifier.
Key exports: `writeAuditLog(db, entry)`, `verifyIntegrity(db, orgId)`.
Writer uses `db.transaction()` + `SELECT FOR UPDATE` to serialize concurrent writes.
8 unit tests (`pnpm --filter @repo/audit test`, vitest, added after the package had none) against a
hand-rolled fake `DbClient` (`src/__tests__/fake-db.ts`) that actually chains inserts in order rather
than a stub that always returns empty — cover first-entry genesis hashing, prevHash chaining across
multiple writes, and `verifyIntegrity` both passing on an untouched chain built through real
`writeAuditLog` calls and correctly identifying the first mismatched row after directly mutating a
row's `metadata` or `hash` (simulating a raw SQL UPDATE against `audit_logs`).

### `packages/sql-validator`
AST-based validation of AI-generated SQL (Postgres dialect, via `node-sql-parser`). Never trusts the
raw SQL string to execute — always returns the AST-rewritten version.
Key export: `validateSql({ sql, cerbosClient, principal, customRole, environment, schemaSnapshot })` →
`ValidatorOutput`. Pipeline: parse (paranoid single-statement enforcement) → comment/forbidden-statement-
type/system-table checks → local column-restriction check → per-table Cerbos `checkDbTable`
authorization → row-filter injection (AST-level, never string-concatenated) → structural warnings
(missing LIMIT, excessive joins, unfiltered destructive write) → risk classification
(SAFE/WARNING/CRITICAL/SECURITY_INCIDENT). Any error-severity violation (parse failure, multi-statement,
forbidden table, unauthorized table/column, invalid row filter) is always SECURITY_INCIDENT — there is
no approval path for those, unlike CRITICAL.

**PII masking (SQ-052) — fixed a real bug, not a new feature.** `checkDbTable`'s `maskedColumns`
*principal* attribute (what Cerbos echoes back as its decision output) was hardcoded to `[]` for every
single query, regardless of any column's `isPii` flag — `apps/tre-executor`'s `maskRow()`, the
`db_table.yaml` echo, and the UI's "masked: X" label were all fully wired and tested, but the one input
that actually mattered was always empty, so **no column was ever masked in this codebase before this
fix**. Fixed by computing the real PII column list per table from the optional `schemaSnapshot` param
(the same role-filtered schema already sent to `ai-service`, so the same data the model saw is what
masking acts on) and gating it on the new `CustomRoleConfig.maskPii` field (optional, undefined/true =
masked, only explicit `false` opts out — "Mask PII columns by default" in the admin UI). The exact same
hardcoded-`[]` bug existed independently in **two test mocks**
(`packages/sql-validator/src/__tests__/test-helpers.ts` and `apps/api/src/__tests__/mock-cerbos.ts`) —
both claimed to "replicate `db_table.yaml`'s decision logic exactly" but had silently drifted from it;
fixed both to actually echo back `principal.attr.masked_columns`, which is what let new tests catch this
at all.

69 adversarial unit tests (`pnpm --filter @repo/sql-validator test`, vitest) cover injection corpora,
statement smuggling via row-filter strings, cross-tenant access, privilege escalation attempts, and the
PII-masking behavior above (masks by default, respects `maskPii: false`, never masks non-PII columns,
masks nothing when no schema snapshot is supplied).

### `packages/secrets`
Two-layer AES-256-GCM envelope encryption (PROOF_OF_CONCEPT.md §7): a random per-secret data key (DEK)
encrypts the plaintext, and the DEK itself is encrypted by a master key (KEK) — rotating the master key
never requires re-encrypting every stored credential. `encryptCredentials`/`decryptCredentials` work on
plain strings and return/accept one JSON-serialized blob (matches `database_connections.encrypted_credentials`'s
`text` column exactly); `encryptDatabaseCredentials`/`decryptDatabaseCredentials` wrap that for the
`{ username, password }` shape specifically. `generateMasterKeyHex()` provisions `CREDENTIAL_MASTER_KEY`.
11 unit tests (`pnpm --filter @repo/secrets test`) cover round-trip, wrong-key rejection, GCM auth-tag
tamper detection (both the outer ciphertext and the wrapped DEK), and that plaintext never appears in
the serialized output.

### `packages/queue`
Shared BullMQ job contracts between `apps/api` (producer), `apps/tre-dispatcher` (consumer/router), and
`apps/tre-executor` (the actual handler `apps/tre-dispatcher` imports and calls). Defines 4 job types —
`test_connection`, `capture_schema`, `execute_read`, `execute_write` — each with its own typed
data/result shape, plus a `JobResultMap` that lets a generic caller (`ExecutionQueueClient.run<T>`) get
back the specific result type for the job it sent, not the full union. `createRedisConnection()` sets
`maxRetriesPerRequest: null`, which BullMQ requires.

### `apps/api`
Express server with tRPC router. Three-tier procedure hierarchy:
- `baseProcedure` — public
- `authedProcedure` — requires valid PASETO v3.local token
- `orgProcedure` — requires valid token + membership in org from `X-Org-Id` header

Context includes `db` (DrizzleClient) and `cerbos` (CerbosClient) singletons.
Env vars: `DATABASE_URL`, `PASETO_LOCAL_KEY` (64 hex chars), `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `CERBOS_URL`,
`AI_SERVICE_URL`, `SERVICE_PRIVATE_KEY` (base64 PKCS8 PEM Ed25519, pairs with ai-service's
`SERVICE_PUBLIC_KEY`), `REDIS_URL`, `CORS_ORIGIN`.

**`apps/api` never opens a connection to a customer database — not even to test one or discover its
schema.** Every one of the three routers below that needs to touch a customer DB enqueues a job via
`src/lib/execution-queue.ts` (`queue.add()` + `job.waitUntilFinished(queueEvents)`, 60s timeout) and
only ever sees the result `apps/tre-executor` hands back.

**`query.submit`** (`src/trpc/routers/query.ts`) — full pipeline in `src/lib/query-pipeline.ts`'s
`submitQuery()`: resolve the caller's `organizationMembers.customRoleId` → `customRoles.config`
(FORBIDDEN if none assigned) → resolve `databaseConnections` + `environments.type` for the given
`connectionId` (NOT_FOUND if it doesn't belong to the caller's org) → resolve the latest
`schemaSnapshots` row (PRECONDITION_FAILED if none captured yet) → filter the snapshot down to the
role's `allowedTables`/`allowedColumns` (SQ-026 schema filtering happens *here*, not in ai-service) →
call `ai-service.ai.generate` (signs a fresh 5-minute PASETO v4.public token per call) → if ai-service
already returned `SECURITY_INCIDENT`, skip sql-validator entirely (no SQL exists) → otherwise run
`sql-validator.validateSql` (passing that *same* `filteredSchema` as its `schemaSnapshot` param, so PII
masking acts on exactly the columns the model was told about — see SQ-052 in the `sql-validator`
section above) → persist a `query_logs` row (now also storing `maskedColumns` and `rowCap`,
since a WARNING needs them again after the user acknowledges, not just at first execution) → branch on
`riskLevel`:
  - **SAFE** → enqueue an `execute_read` job immediately, update `query_logs` to `EXECUTED`/`FAILED` with
    the real `rowCount`/`executionMs`, return the masked rows to the caller in the same response.
  - **WARNING** → enqueue an `execute_read` job with `explainOnly: true` (SQ-038 — runs
    `EXPLAIN (FORMAT JSON)` inside the same `BEGIN ... ROLLBACK` read-only transaction, no rows fetched,
    just the planner's `Plan Rows` estimate), store it as `query_logs.simulationResult`, set
    `query_logs.status = 'AWAITING_ACKNOWLEDGMENT'` — nothing executes yet. `result` is `null`,
    `requiresAcknowledgment: true` tells the caller to call `query.acknowledge` next (SQ-037).
  - **CRITICAL** → enqueue an `execute_write` job with `dryRun: true` (the exact affected rows via
    `RETURNING * ... ROLLBACK`, nothing committed), store that as the `approval_requests.simulationResult`
    a reviewer will see, create the `approval_requests` row.
  - **SECURITY_INCIDENT** → persist straight to `FAILED`, nothing enqueued, no approval path.
Audit entries: `QUERY_SUBMITTED` always; `QUERY_EXECUTED`/`QUERY_FAILED` after a read runs;
`APPROVAL_REQUESTED` for CRITICAL; `SECURITY_INCIDENT_DETECTED` on rejection.

**`query.acknowledge`** (`src/trpc/routers/query.ts`, `acknowledgeQuery()` in the same
`query-pipeline.ts`) — the other half of SQ-037. Takes a `queryLogId`; CONFLICT unless its status is
still `AWAITING_ACKNOWLEDGMENT`, FORBIDDEN unless the caller is the original submitter (self-service ack,
not a reviewer decision — no Cerbos action for this, it's a continuation of the request the caller
already had authorized, not a new authorization decision). On success: writes `QUERY_ACKNOWLEDGED` to
the audit log, then re-enqueues the *same* validated SQL as a real (non-`explainOnly`) `execute_read`
job using the `rowCap`/`maskedColumns` persisted on the `query_logs` row at submit time (so the
re-execution honors exactly what was already validated, not a freshly-refetched value that could have
drifted), and updates `query_logs` to `EXECUTED`/`FAILED` exactly like the SAFE path does.

**`organization.list`** (`src/trpc/routers/organization.ts`, `listMyOrganizations()` in
`src/lib/organization-pipeline.ts`) — `authedProcedure`, not `orgProcedure`: the caller doesn't have an
org selected yet when they need this (it's how the web client lets them pick one). Joins
`organization_members` (by `userId`) to `organizations` (by the resulting `orgId`s) and returns
`{ id, name, slug, platformRole }` per org. No Cerbos check — unlike `query`/`approval_request`/
`database_connection`, "which orgs am I a member of" isn't a resource-access decision Cerbos models;
membership rows are the only source of truth, the same ones `orgProcedure` itself reads on every request.

**`databaseConnection.create`/`.list`/`.captureSchema`** (`src/trpc/routers/database-connection.ts`,
`src/lib/connection-pipeline.ts`) — SQ-019/020/021/022. `create` enqueues a `test_connection` job (which
also encrypts on success — `apps/tre-executor` is the only place a brand-new connection's credentials
ever get encrypted, since `CREDENTIAL_MASTER_KEY` only lives there); only persists the connection row if
that job succeeds, and only ever stores the encrypted envelope it gets back, never the plaintext
password. `captureSchema` enqueues a `capture_schema` job and stores the resulting column metadata
(with a regex PII heuristic — `apps/tre-executor`'s `buildSnapshot()`) as a new `schema_snapshots` row.
Both Cerbos-gated via `checkDatabaseConnection` (`create`/`read` require `same_org_admin`).

**`approval.list`** (`src/trpc/routers/approval.ts`, `listApprovals()` in `approval-pipeline.ts`) — lists
every approval request in the caller's org, joins in the linked `query_logs` row (prompt/SQL/risk) so a
UI doesn't need a second round trip per item, then filters to what Cerbos says the caller may `read` —
**one batched `checkResources` call covering every row, not N** (`filterReadableApprovals()` in
`packages/policy-client`). Reviewers/admins/owners see everything in the org (`same_org_approver`);
analysts see only the requests they personally submitted (`request_submitter`) — both rules already
existed in `approval_request.yaml`'s `read` action, this just calls them at list-time instead of only at
decide-time.

**`approval.decide`** (`src/trpc/routers/approval.ts`, `src/lib/approval-pipeline.ts`) — a Reviewer/Admin/Owner
approves or rejects a `PENDING` `CRITICAL` approval request. Four-eyes (a submitter can't approve their
own request) is enforced by Cerbos's DENY rule in `approval_request.yaml`, not re-implemented in app
code. On **REJECTED**: `approval_requests.status = 'REJECTED'`, `query_logs.status = 'CANCELLED'`, nothing
enqueued. On **APPROVED**: enqueues the *same validated SQL* as an `execute_write` job with
`dryRun: false` — no data is copied or merged from the earlier dry-run, this fresh run's `COMMIT` is the
change reaching production (PROOF_OF_CONCEPT.md §12) — then updates `query_logs` to `EXECUTED`/`FAILED`.

The WARNING acknowledgment step now has a `web` UI screen too (`apps/web/app/query-result.tsx`'s
"Acknowledge & Run" button), not just Postman folder 4 — see the `apps/web` section below.

**`audit.list`/`audit.verifyIntegrity`** (`src/trpc/routers/audit.ts`, `src/lib/audit-pipeline.ts`) —
SQ-058's backend half. `list` fetches the org's most recent 200 `audit_logs` rows, joins in the actor's
name/email so the UI doesn't need a second round trip per row, then filters through Cerbos with the
same batched-`checkResources` pattern as `approval.list` (`filterReadableAuditLogs()` in
`packages/policy-client`) — admins/owners/reviewers see the whole org's trail (`same_org_admin`/
`same_org_approver`), everyone else only sees entries where they're the recorded actor (`log_actor`),
per `audit_log.yaml`. `verifyIntegrity` is a stricter gate: `audit_log.yaml` restricts the
`verify_integrity` action to `same_org_admin` only (not `same_org_approver`/`log_actor` — recomputing
the whole chain reveals whether *other people's* entries were tampered with), and on success just
calls straight through to `packages/audit`'s `verifyIntegrity(db, orgId)`, returning whichever row (if
any) was the first hash mismatch.

**`customRole.list`/`.create`/`.update`/`.delete`** (`src/trpc/routers/custom-role.ts`,
`src/lib/custom-role-pipeline.ts`) — SQ-017, the literal "custom roles as data" architecture decision
made operable from the UI instead of requiring a seed script. All four actions are `same_org_admin`-only
(`custom_role.yaml`); `list` joins in a live per-role `memberCount` computed from
`organization_members` (not stored/cached on the role row — always current). `delete` relies on the
schema's `custom_role_id` FK `ON DELETE SET NULL`: members assigned to a deleted role simply lose
`query.submit` capability rather than the delete being blocked or cascading.

**`environment.list`/`.updateType`** (`src/trpc/routers/environment.ts`,
`src/lib/environment-pipeline.ts`) — SQ-018. `list` returns each environment with a **`posture`
string describing what the risk engine actually does today** for that `type`
(`packages/sql-validator/src/risk.ts`'s real branching — production writes are always CRITICAL,
everything else is WARNING unless unfiltered-destructive), not aspirational policy copy. `updateType`
is the one real "Configure" lever this exposes: changing an environment's `development`/`staging`/
`production` classification immediately changes how the risk engine classifies every future write
against it, since `risk.ts` reads that field directly — there's no separate policy-posture schema to
keep in sync.

**`dashboard.summary`** (`src/trpc/routers/dashboard.ts`, `src/lib/dashboard-pipeline.ts`) — the
workspace-settings stat cards (queries today by risk level, pending-approval count + average wait,
security incidents in the last 30 days, audit-chain status). Every number is a live aggregate computed
in application code from `query_logs`/`approval_requests`/`audit_logs` (`Array.filter`/`reduce` after
`findMany`, matching this codebase's existing style of app-level rather than SQL-level aggregation) —
none of it is cached or precomputed. Gated by its own `dashboard.yaml` Cerbos policy
(`same_org_admin`, action `read`) rather than reusing `audit_log.yaml`'s `verify_integrity` action,
even though it also calls `packages/audit`'s `verifyIntegrity()` directly — the dashboard's own
`dashboard:read` check already establishes the caller is an org admin, so asking Cerbos the same
question twice under two different resource names would just be redundant.

58 unit tests (`pnpm --filter @repo/api test`, vitest) across 8 files cover all of the above — risk-level
branching, the guard clauses (FORBIDDEN/NOT_FOUND/PRECONDITION_FAILED/CONFLICT), schema filtering,
four-eyes rejection, and that plaintext credentials never appear in anything persisted — using
lightweight in-memory mocks for `db`/Cerbos/ai-service/the execution queue, never a real Postgres,
Redis, or network call. The mock `db`'s update-then-`.returning()` chain (`apps/api/src/__tests__/mock-db.ts`)
falls back to the relevant `findFirst` fixture when a test does find-then-update rather than
insert-then-update, so `customRole.update`/`environment.updateType` didn't need a parallel mock.

### `apps/tre-executor`
**The only component in this entire codebase allowed to touch a customer database**, and the only one
holding `CREDENTIAL_MASTER_KEY`. Not a standalone running service — a library of handler functions
(`src/lib/*.ts`) that `apps/tre-dispatcher` imports and calls directly; this is the Phase-1 simplification
of "BullMQ + worker_threads" (PROOF_OF_CONCEPT.md §27) — true process/container isolation per write is a
documented Phase-3 upgrade (container TRE), not silently claimed now.

Four handlers, one per `packages/queue` job type, each taking an injectable `ClientFactory`/`CursorFactory`
so they're fully unit-testable against a fake `pg.Client` (`src/__tests__/fake-client.ts`) — no real
Postgres needed:
- **`handleTestConnection`** — connects with the raw plaintext credentials from the job payload, runs
  `SELECT 1`, encrypts on success via `packages/secrets` (the only place this happens), never persists.
- **`handleCaptureSchema`** — queries `information_schema.columns`, groups into the `ColumnDefinition[]`
  shape, flags likely-PII columns by name (`buildSnapshot()`'s regex heuristic — a hint for the AI
  prompt, not the security boundary; Cerbos's `maskedColumns` output is what's actually enforced).
- **`handleExecuteRead`** — `BEGIN TRANSACTION READ ONLY`, `pg-cursor` fetches `rowCap + 1` rows (one
  extra to detect truncation without a separate `COUNT(*)`), `ROLLBACK` (nothing was ever going to
  commit), masks the Cerbos-returned `maskedColumns` (`maskRow()`) before returning. When the job's
  `explainOnly: true` (the WARNING path, SQ-038), it runs `EXPLAIN (FORMAT JSON) <sql>` instead of the
  cursor fetch, still inside the same read-only transaction, then `ROLLBACK`s without ever materializing
  a row — returns the planner's `Plan Rows` estimate (`estimatedRowCount`) and the raw plan JSON (`plan`)
  for the caller to show the user before they decide whether to actually run it.
- **`handleExecuteWrite`** — `BEGIN`, sets `statement_timeout`/`lock_timeout`, appends `RETURNING *` to
  the already-validated single-statement SQL, then `ROLLBACK` (`dryRun: true`, the simulation) or
  `COMMIT` (`dryRun: false`, only after approval).

Env vars: `CREDENTIAL_MASTER_KEY` (64 hex chars — **never set this anywhere else**), `STATEMENT_TIMEOUT_MS`,
`LOCK_TIMEOUT_MS`, `DEFAULT_ROW_CAP`. 22 unit tests (`pnpm --filter @repo/tre-executor test`, vitest).

### `apps/tre-dispatcher`
The actual running process — a BullMQ `Worker` consuming `packages/queue`'s shared execution queue,
calling `apps/tre-executor`'s `handleJob()` per job. Deliberately thin: routing is the entire job.
Env vars: `REDIS_URL`, `WORKER_CONCURRENCY` (default 5 — reads and writes currently share one pool;
tiered isolation between them is a Phase-3 concern per the same container-TRE upgrade path above).

### `apps/ai-service`
Standalone Express + tRPC service — text-to-SQL generation, isolated from `apps/api` per the architecture
(`api → ai-service` is `tRPC` over `PASETO v4.public`, not in-process). Has no DB access; `apps/api` is
responsible for resolving the user's custom role and schema snapshot and passing in an already-filtered
schema — `ai-service` never sees tables/columns the caller didn't explicitly include.

Pipeline (`generateSql()` in `src/lib/generate-sql.ts`), matching PROOF_OF_CONCEPT.md §5.1 exactly:
`sanitize` (strip control/invisible chars, NFKC-normalize) → `screen` (regex heuristics, then a cheap
model second-opinion via `Output.choice` — either positive blocks generation entirely, no API call to
the main model) → `generateText` with `output: Output.object(GeneratedSqlSchema)` → return.
A screen-blocked or empty-after-sanitization prompt returns a `GeneratedSql`-shaped result with
`riskLevel: 'SECURITY_INCIDENT'` and empty `sql` — the caller should skip `sql-validator` entirely in
that case (there's no SQL to validate) and go straight to audit + reject.

**Provider:** OpenAI directly via `@ai-sdk/openai` (`createOpenAI({ apiKey })`), not the Vercel AI
Gateway — chosen because the user has an OpenAI API key, not a Vercel account. Default models
(verified live against the AI Gateway's model-list endpoint, not assumed): `AI_MODEL=gpt-5.5`
(generation), `AI_SCREEN_MODEL=gpt-5.4-nano` (injection screening). Both configurable via env var —
swapping providers means only touching `src/lib/model.ts`.

**Critical AI SDK 6 note:** `generateObject`/`streamObject` are deprecated (removed in a future version).
This codebase uses the current pattern: `generateText({ model, output: Output.object({ schema }) })`,
reading `result.output` — not `result.object`. See `.agents/skills/ai-sdk/SKILL.md`; before touching
this code, re-verify against `node_modules/ai/docs/` rather than trusting memory — the SDK's own skill
file says training-data knowledge of it is unreliable.

Auth: every procedure except `health.check` requires `serviceProcedure` (PASETO v4.public, verified
against `SERVICE_PUBLIC_KEY`) — there is no public/anonymous surface.
Env vars: `OPENAI_API_KEY`, `AI_MODEL`, `AI_SCREEN_MODEL`, `SERVICE_PUBLIC_KEY` (base64 SPKI PEM), `CORS_ORIGIN`.
38 unit tests (`pnpm --filter @repo/ai-service test`, vitest) cover sanitization, the heuristic injection
corpus, schema-prompt rendering, and the full pipeline using `ai/test`'s `MockLanguageModelV3` — no real
OpenAI calls in CI.

### `apps/web`
Next.js 16 App Router, calling `apps/api`'s tRPC router directly over `httpBatchLink` (no Next.js API
route in between — `app/api/trpc/server.tsx` exists only for any future RSC-side tRPC calls, the browser
client in `trpc/client.tsx` talks straight to `NEXT_PUBLIC_API_URL`).

**Design system** — follows `Docs/Design/Design.md`'s near-monochrome language exactly: warm charcoal
ink (`#111210`) for actions/headings, cool gray surfaces, and color reserved for risk signals only
(badge + dot + soft tint — never a full card background or border). Tailwind CSS 4 `@theme` tokens in
`app/globals.css` (`--color-safe`/`--color-warning`/`--color-critical`/`--color-incident`/`--color-neutral`,
plus a fixed `--color-code-bg`/`--color-code-fg` pair for the one deliberate dark surface in the system —
SQL code chips). No dark-mode variant — the design reference is light-only, so one was never built rather
than half-built. Four shared components in `app/components/` (`Badge`, `Button`, `Card`, `CodeBlock`) are
the only place these tokens get composed into classNames; pages import them rather than repeating
Tailwind strings. `SECURITY_INCIDENT` maps to the **incident** (blue) tone, not **critical** (red) — a
deliberate choice carried over from the design doc: red stays reserved for CRITICAL/destructive ops
awaiting a decision, so it stays the loudest, least-ambiguous signal in the system.

**Auth (`lib/session.tsx`)** — a `SessionProvider` persists `{ sessionToken, orgId, userId, email }` to
`localStorage`; `getStoredSession()` is the non-React escape hatch the tRPC link's `headers()` callback
uses (that callback runs per-request outside any component tree, so it can't call a hook). The login page
(`app/login/page.tsx`) does the same Keycloak **direct password grant** Postman uses against
`safequery-web`'s dev-only `directAccessGrantsEnabled: true` client, then calls `auth.exchangeToken` —
explicitly documented in the UI as a dev shortcut, not the production OIDC redirect + PKCE flow. The
session is stored with an empty `orgId` first (`organization.list` only needs `Authorization`, not
`X-Org-Id`, so `authedProcedure` is enough — it doesn't gate on org membership the way `orgProcedure`
does), then the login page calls the new `organization.list` endpoint and either auto-selects the single
org or shows a picker — **no manually-pasted orgId anywhere**, including in Postman's "List Approvals"-style
manual config; `organization.list` resolves live from `organization_members`, the same source of truth
`orgProcedure` itself checks on every request.

**Pages:**
- `app/page.tsx` (Chat) — connection picker (`databaseConnection.list`) + natural-language textarea →
  `query.submit`. `app/query-result.tsx` renders the response by `riskLevel`: SAFE/executed-WARNING show
  a results table; pending-WARNING shows the EXPLAIN estimate + an "Acknowledge & Run" button wired to
  `query.acknowledge`; CRITICAL shows the dry-run preview + a copyable `approvalRequestId`;
  SECURITY_INCIDENT shows the rejection reason. `result`/`riskLevel`/etc. are typed via
  `inferRouterOutputs<AppRouter>['query']['submit']` — no duplicated type definitions between `apps/api`
  and `apps/web`.
- `app/approvals/page.tsx` (Reviewer) — lists requests via `approval.list` (click one to select it, or
  paste an ID manually) and Approve/Reject via `approval.decide`. Cerbos's four-eyes DENY rule still
  applies — a submitter selecting their own request gets `FORBIDDEN`.
- `app/audit-log/page.tsx` — `audit.list` rendered as a TIME/EVENT/RISK/HASH table (action names
  humanized from `SCREAMING_SNAKE_CASE` rather than a hand-maintained lookup table, so new
  `AuditAction` values render correctly with zero changes here); the RISK column only shows a badge
  when the row actually carries a `riskLevel` in its metadata or is a `SECURITY_INCIDENT_DETECTED`
  entry — no risk is invented for action types that don't have one (e.g. `POLICY_UPDATED`). "Re-verify
  chain" calls `audit.verifyIntegrity`; if it comes back invalid, the one row matching
  `firstMismatchId` gets a red background and a "Tampered" badge — the rest of the table stays exactly
  as monochrome as before, which is what makes that one row read as a genuine alarm.

- `app/admin/page.tsx` (Admin/Owner only — redirects everyone else to `/`) — workspace-settings
  dashboard matching `Docs/Design/image-4.png`: `dashboard.summary`'s 4 stat cards, a custom-roles
  table (`customRole.list`) with an inline create form and a per-row inline edit form
  (`app/admin/role-form.tsx`, reused for both — same component, prefilled vs. empty initial values),
  and an environment policy posture table (`environment.list`) where the type dropdown calls
  `environment.updateType` directly — no separate "save" step. `Session` now carries `platformRole`
  (set from the selected org's membership row at login) so the nav bar and this page's own redirect
  guard can both gate on it client-side, in addition to the real enforcement happening server-side via
  `custom_role.yaml`/`environment.yaml`/`dashboard.yaml`'s Cerbos checks.
- `app/audit-log/page.tsx` — `audit.list` rendered as a TIME/EVENT/RISK/HASH table (action names
  humanized from `SCREAMING_SNAKE_CASE` rather than a hand-maintained lookup table, so new
  `AuditAction` values render correctly with zero changes here); the RISK column only shows a badge
  when the row actually carries a `riskLevel` in its metadata or is a `SECURITY_INCIDENT_DETECTED`
  entry — no risk is invented for action types that don't have one (e.g. `POLICY_UPDATED`). "Re-verify
  chain" calls `audit.verifyIntegrity`; if it comes back invalid, the one row matching
  `firstMismatchId` gets a red background and a "Tampered" badge — the rest of the table stays exactly
  as monochrome as before, which is what makes that one row read as a genuine alarm.

All four protected pages redirect to `/login` client-side if `useSession()` has no session — there's no
middleware-level route protection yet (P2/P3 concern once `apps/web` needs SSR-authenticated routes).

**A real bug caught during browser verification, worth remembering**: tRPC's `httpBatchLink` batches
every `useQuery` that fires in the same tick into one combined request
(`/trpc/dashboard.summary,customRole.list,environment.list?batch=1...`). A Playwright mock registered
for just `**/trpc/dashboard.summary**` will still match that combined URL (it's a substring), silently
intercepting all three calls and returning a 1-item array where 3 were expected — symptoms looked like
a missing-data bug in `app/admin/page.tsx` (the environment table rendered empty) when the actual app
code was correct the whole time. Any future Playwright verification of a page with multiple sibling
`useQuery` calls needs one route mock that returns a properly-ordered, properly-sized array, not one
mock per procedure name.

---

## Infrastructure

### Docker Compose (`infra/docker/docker-compose.yml`)
4 services: `postgres:16-alpine`, `redis:7-alpine`, `keycloak:24.0`, `cerbos:latest`.
Copy `infra/docker/.env.example` → `infra/docker/.env` before running.

### Cerbos Policies (`infra/docker/cerbos/policies/`)
Policy files follow Cerbos `api.cerbos.dev/v1` schema:
- Derived roles are in **separate files** (`derived_roles_*.yaml`) — NOT inline in resource policies
- Resource policies use `importDerivedRoles:` to reference them
- `derived_roles_common.yaml` — `same_org_member`, `same_org_submitter`, `same_org_approver`, `same_org_admin`
- `derived_roles_query.yaml` — `query_owner`
- `derived_roles_approval.yaml` — `request_submitter`
- `derived_roles_audit.yaml` — `log_actor`
- `db_table.yaml` — the one generic, per-product policy for raw data-table access (see PROOF_OF_CONCEPT.md
  §16). Attribute-only, no Cerbos roles — gates on `org_id` match + table in `table_scope` + action in
  `capabilities`, all flattened from the caller's resolved `CustomRoleConfig`. Echoes back `rowFilter` /
  `maskedColumns` as output for `sql-validator` to inject; never invents them itself.

### Keycloak (`infra/docker/keycloak/safequery-realm.json`)
Realm `safequery`, client `safequery-web` (public PKCE), client `safequery-api` (confidential).

---

## Module Resolution Pattern

All packages use `"moduleResolution": "Bundler"` (via `node-library.json` tsconfig) and export raw TypeScript source files directly (`"exports": { ".": "./src/index.ts" }`). No build step for packages. TSConfigs have explicit `paths` mappings for workspace packages.

---

## Defense-in-Depth (12 Layers)

1. Authentication (Keycloak OIDC)
2. Authorization (Cerbos live decisions)
3. Policy invariants (production-write DENY rules)
4. Prompt injection screen
5. Schema filtering (AI never sees full schema or credentials)
6. AST validation
7. Row-filter injection (Cerbos decisions applied as SQL predicates)
8. Risk engine (4-level classification)
9. TRE isolation (separate executor, network-isolated)
10. Database roles + RLS (row-level enforcement)
11. Immutable audit log (hash chain)
12. Observability (anomaly detection)

---

## Phase Build Plan

| Phase | Focus | Status |
|-------|-------|--------|
| P0 | Foundation | ✅ **COMPLETE** — infra, types, db, auth, policy-client, audit, apps/api |
| P1 | **The Differentiator** | ✅ **COMPLETE and end-to-end** — sql-validator, ai-service, query.submit, query.acknowledge, database-connection CRUD, approval-decision, tre-dispatcher, tre-executor, packages/secrets, packages/queue. All four risk paths (SAFE/WARNING/CRITICAL/SECURITY_INCIDENT) execute for real, not just classify; WARNING gets a real EXPLAIN-based simulation + self-acknowledgment gate (SQ-037/SQ-038). Only gap: no live DB migrated yet in this dev environment (Docker not running) |
| P2 | Governance | ✅ Audit viewer UI (SQ-058), custom-roles CRUD UI (SQ-017/SQ-055 partial), environments CRUD (SQ-018), PII column masking (SQ-052, was a long-standing no-op until this fix) all done — `apps/web/app/admin` + `apps/web/app/audit-log`. Still 🔲: multi-tenancy UI, multiple DB connections UI, time-window policies |
| P3 | Real Isolation | 🔲 Container TRE (true per-write process isolation — tre-executor is currently a library tre-dispatcher calls in-process, not yet its own container/worker_thread), Vault dynamic secrets replacing packages/secrets |
| P4 | Cloud-Native | 🔲 k8s, Vercel, GitHub Actions CI/CD |
| P5 | Observability | 🔲 OpenTelemetry, Prometheus/Grafana, Loki, Sentry, Terraform |

**What "P1 complete" means concretely:** `query.submit` now actually executes — a SAFE query returns
real (masked) rows in the same response; a WARNING query gets a real `EXPLAIN`-based simulation and
waits for `query.acknowledge` before it actually runs; a CRITICAL query gets a real dry-run simulation
and creates an approval request; `approval.decide` re-runs and commits the exact validated SQL on
approval. `databaseConnection.create`/`.captureSchema` give the pipeline real connections and real
schema snapshots to work with, instead of requiring hand-seeded fixtures. None of this required
`apps/api` to ever open a `pg` connection — every customer-DB touch goes through
`packages/queue` → `apps/tre-dispatcher` → `apps/tre-executor`, which is the one place
`CREDENTIAL_MASTER_KEY` exists.

**What's still simplified vs. the canonical spec, by design, for P1:** `apps/tre-executor` is a plain
TypeScript module `apps/tre-dispatcher` calls in-process — not yet its own `worker_threads`/container
boundary (Phase 3). `apps/web` now has a chat UI (analyst), a real reviewer queue (`approval.list`),
live org selection (`organization.list`), an audit log viewer with tamper detection
(`audit.list`/`audit.verifyIntegrity`), and an admin workspace-settings dashboard with live custom-roles
CRUD and environment policy posture (`customRole.*`/`environment.*`/`dashboard.summary`) — covering all
four risk paths end-to-end with nothing manually-pasted — but auth is still the dev-only Keycloak direct
grant rather than the full OIDC redirect + PKCE flow the canonical spec describes. See
`Docs/04_FEATURE_TICKET_LIST.md` tickets SQ-025 to SQ-042 — all done (SQ-017/SQ-018/SQ-058 from P2 also
done, ahead of their phase).

---

## Development Commands

```bash
# Start infra (Postgres, Redis, Keycloak, Cerbos)
docker compose -f infra/docker/docker-compose.yml up -d

# Install deps
pnpm install

# Generate the two keys every fresh checkout needs before anything will boot:
#   PASETO_LOCAL_KEY      -> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   SERVICE_PRIVATE_KEY/SERVICE_PUBLIC_KEY (one keypair, split across apps/api + apps/ai-service):
#     pnpm --filter @repo/api exec tsx -e "const {generateServiceKeypairBase64}=require('@repo/auth'); console.log(generateServiceKeypairBase64())"
#   CREDENTIAL_MASTER_KEY (apps/tre-executor ONLY):
#     pnpm --filter @repo/tre-executor exec tsx -e "console.log(require('@repo/secrets').generateMasterKeyHex())"
# Copy each app's .env.example -> .env and fill these in.

# Dev mode (all apps, including apps/tre-dispatcher which must be running
# for query.submit/approval.decide/databaseConnection.* to do anything —
# they enqueue jobs and wait for it)
pnpm dev

# Type-check / lint / test all packages
pnpm check-types
pnpm lint
pnpm test

# Database migrations (run after schema changes)
pnpm --filter @repo/db db:generate    # generate migration files
pnpm --filter @repo/db db:migrate     # apply to DB (DATABASE_URL must be set)

# After migrate: apply RLS policies
# psql $DATABASE_URL -f packages/db/src/rls-policies.sql
```

Node >= 18 required. pnpm 9 required.

---

## Key Decisions (ADRs — Do Not Reverse Without Discussion)

- **PostgreSQL-only in v1** — covers Supabase, Neon, RDS, self-hosted
- **Keycloak not hand-rolled auth** — integrates with existing enterprise IdPs
- **PASETO not JWT** — eliminates algorithm-confusion attacks. Sessions use v3.local (not v4.local — `paseto` npm doesn't implement XChaCha20). Service-to-service (`api`→`ai-service`) uses v4.public (Ed25519) — `paseto` npm does implement this one
- **OpenAI directly, not Vercel AI Gateway** — user has an OpenAI API key, not a Vercel account; provider pattern in `apps/ai-service/src/lib/model.ts` keeps this swappable later
- **`generateText` + `Output.object`, not `generateObject`** — AI SDK 6 deprecated `generateObject`/`streamObject`; this codebase follows current guidance, not the soon-to-be-removed API
- **Cerbos not hand-rolled RBAC** — externalized, auditable, attribute-based; derived roles in separate files per Cerbos spec
- **Custom roles as DB rows** — org admins configure without redeploy
- **Drizzle ORM** — SQL migrations as code, typed, RLS defined in schema
- **tRPC for internal APIs** — end-to-end type safety
- **No direct API→customer DB** — all execution through queue-based TRE; enforced by construction (`apps/api` has no `pg` dependency at all, only `@repo/queue`)
- **Two-layer envelope encryption, not direct master-key encryption** — a random per-secret DEK encrypts the credentials, the DEK is encrypted by the KEK (`CREDENTIAL_MASTER_KEY`); rotating the master key never requires re-encrypting every connection
- **`CREDENTIAL_MASTER_KEY` lives only on `apps/tre-executor`** — including for *encrypting* a brand-new connection's credentials, not just decrypting; `apps/api` enqueues a `test_connection` job and only ever receives the already-encrypted envelope back, so it never has the means to decrypt anything even if compromised
- **`apps/tre-executor` is an in-process module, not yet its own container** — Phase 1 deliberately simplifies "BullMQ + worker_threads" to "BullMQ dispatcher importing a handler library"; true per-write process isolation is the documented Phase 3 upgrade, not silently skipped
- **Hash-chain audit** — tamper-evident without blockchain operational overhead
- **Source package pattern** — packages export `.ts` directly, `moduleResolution: Bundler`, no build step

---

## Coding Conventions

- TypeScript strict mode everywhere
- Zod for all validation at system boundaries (user input, external APIs, AI output)
- Pino for structured JSON logging — use redaction config to strip credentials
- All shared logic goes in `packages/` not duplicated in apps
- tRPC procedures in `apps/api/` — never define API logic in `apps/web/`
- Cerbos decisions are the authorization source of truth — never replicate logic in application code
- No raw SQL strings passed to database — always through Drizzle or parameterized pg queries
- Audit writes always go through `writeAuditLog()` — never insert directly to `audit_logs`

---

## Success Criteria (From PRD)

- 100% of analyst queries go through NL interface
- 0 blind executions (every query validated + logged)
- 0 destructive ops without CRITICAL approval flow
- 100% of state-changing actions in audit log
- Audit integrity check passes on demand; tampering detectable
- 0 cross-tenant data access incidents
- All four query paths (SAFE / WARNING / CRITICAL / SECURITY_INCIDENT) demoable end-to-end
