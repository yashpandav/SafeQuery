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
│   ├── web/              # Next.js 16 — early stage, tRPC client wired to apps/api
│   ├── api/              # Express + tRPC — core API server ✅ BUILT
│   ├── ai-service/       # Vercel AI SDK — SQL generation (NOT YET CREATED)
│   ├── tre-dispatcher/   # BullMQ job dispatch (NOT YET CREATED)
│   └── tre-executor/     # DB execution worker (NOT YET CREATED)
├── packages/
│   ├── ui/               # Shared React components ✅ EXISTS
│   ├── types/            # Shared Zod schemas + TypeScript types ✅ BUILT
│   ├── auth/             # Keycloak OIDC + PASETO v3.local helpers ✅ BUILT
│   ├── db/               # Drizzle ORM schema + RLS + migrations ✅ BUILT
│   ├── sql-validator/    # AST parsing, Cerbos decisions, row-filter injection ✅ BUILT
│   ├── policy-client/    # Cerbos HTTP client wrapper ✅ BUILT
│   ├── audit/            # Hash-chain audit writer + verify-integrity ✅ BUILT
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
| Sessions/Tokens | PASETO **v3.local** (AES-256-CTR + HMAC-SHA384 via Node.js native crypto) |
| Authorization | Cerbos 0.28 (HTTP, attribute-based policy decision point) |
| AI | Vercel AI SDK, structured outputs via Zod, provider pattern |
| SQL Processing | node-sql-parser (AST), Cerbos decisions, row-filter injection |
| Job Queue | BullMQ + Redis 7 |
| DB Execution | pg + pg-cursor (row caps), worker_threads (P1), Docker (P2), k8s (P3+) |
| Secret Mgmt | AES-256-GCM envelope (P1) → HashiCorp Vault dynamic secrets (P3) |
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
- `organization_members` has a composite primary key `(org_id, user_id)`
- `audit_logs` has `prev_hash` + `hash` columns forming a SHA-256 hash chain

RLS policies live in `packages/db/src/rls-policies.sql` (run after `drizzle-kit migrate`).

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
PASETO v3.local session tokens + Keycloak OIDC JWT verification.
Key exports: `signSession()`, `verifySession()`, `verifyKeycloakToken()`, `extractBearerToken()`.
**Note:** v3.local (not v4) — `paseto` npm package does not implement XChaCha20 (v4.local).

### `packages/policy-client`
Cerbos HTTP client wrapper with typed check functions per resource.
Key exports: `createCerbosClient()`, `checkQuery()`, `checkApproval()`, `checkDatabaseConnection()`, `checkAuditLog()`, `canSubmitQuery()`, `canApproveQuery()`.

### `packages/audit`
Hash-chain audit log writer and integrity verifier.
Key exports: `writeAuditLog(db, entry)`, `verifyIntegrity(db, orgId)`.
Writer uses `db.transaction()` + `SELECT FOR UPDATE` to serialize concurrent writes.

### `packages/sql-validator`
AST-based validation of AI-generated SQL (Postgres dialect, via `node-sql-parser`). Never trusts the
raw SQL string to execute — always returns the AST-rewritten version.
Key export: `validateSql({ sql, cerbosClient, principal, customRole, environment })` → `ValidatorOutput`.
Pipeline: parse (paranoid single-statement enforcement) → comment/forbidden-statement-type/system-table
checks → local column-restriction check → per-table Cerbos `checkDbTable` authorization → row-filter
injection (AST-level, never string-concatenated) → structural warnings (missing LIMIT, excessive joins,
unfiltered destructive write) → risk classification (SAFE/WARNING/CRITICAL/SECURITY_INCIDENT).
Any error-severity violation (parse failure, multi-statement, forbidden table, unauthorized table/column,
invalid row filter) is always SECURITY_INCIDENT — there is no approval path for those, unlike CRITICAL.
65 adversarial unit tests (`pnpm --filter @repo/sql-validator test`, vitest) cover injection corpora,
statement smuggling via row-filter strings, cross-tenant access, and privilege escalation attempts.

### `apps/api`
Express server with tRPC router. Three-tier procedure hierarchy:
- `baseProcedure` — public
- `authedProcedure` — requires valid PASETO v3.local token
- `orgProcedure` — requires valid token + membership in org from `X-Org-Id` header

Context includes `db` (DrizzleClient) and `cerbos` (CerbosClient) singletons.
Env vars: `DATABASE_URL`, `PASETO_LOCAL_KEY` (64 hex chars), `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `CERBOS_URL`, `CORS_ORIGIN`.

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
| P1 | **The Differentiator** | 🔲 Next — AI service, sql-validator, risk engine, TRE executor, query pipeline |
| P2 | Governance | 🔲 Multi-tenancy UI, custom-roles, approval workflow, multiple DB connections |
| P3 | Real Isolation | 🔲 Container TRE, Vault secrets, dispatcher/executor apps |
| P4 | Cloud-Native | 🔲 k8s, Vercel, GitHub Actions CI/CD |
| P5 | Observability | 🔲 OpenTelemetry, Prometheus/Grafana, Loki, Sentry, Terraform |

**P1 starting point:** `packages/sql-validator` (AST + Cerbos validation) and `apps/ai-service` (Vercel AI SDK, structured SQL generation). See `Docs/04_FEATURE_TICKET_LIST.md` tickets SQ-025 to SQ-042.

---

## Development Commands

```bash
# Start all services
docker compose -f infra/docker/docker-compose.yml up -d

# Install deps
pnpm install

# Dev mode (all apps)
pnpm dev

# Type-check all packages
pnpm check-types

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
- **PASETO v3.local not JWT** — eliminates algorithm-confusion attacks; v3 (not v4) because `paseto` npm does not implement v4.local (XChaCha20 is not in Node.js native crypto)
- **Cerbos not hand-rolled RBAC** — externalized, auditable, attribute-based; derived roles in separate files per Cerbos spec
- **Custom roles as DB rows** — org admins configure without redeploy
- **Drizzle ORM** — SQL migrations as code, typed, RLS defined in schema
- **tRPC for internal APIs** — end-to-end type safety
- **No direct API→customer DB** — all execution through queue-based TRE
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
