# SafeQuery — Claude Code Project Guide

## What This Is

SafeQuery is an **Enterprise AI Database Governance Platform** — a control plane that sits between an LLM and a real database. It enforces policy, validates AI-generated SQL as untrusted input, routes by risk, executes in an isolated Trusted Runtime Environment (TRE), masks PII, and records everything in a tamper-evident hash-chain audit log.

**The core problem it solves:** Employees paste AI-generated SQL directly into production databases with no validation, no permission checks, no approval step, and no audit trail. SafeQuery replaces that workflow.

**Full specifications live in `Docs/`:**
- `Docs/01_PRODUCT_REQUIREMENTS.md` — PRD, user stories, FR list, success metrics
- `Docs/02_TECHNICAL_ARCHITECTURE.md` — TAD, system diagram, data model, ADRs
- `Docs/03_SECURITY_AND_ACCESS.md` — identity/auth/authz, defense-in-depth, threat model
- `Docs/04_FEATURE_TICKET_LIST.md` — engineering backlog, epics, phases P0–P5
- `Docs/PROOF_OF_CONCEPT.md` — complete reference spec (789 lines, canonical truth)

---

## Monorepo Structure (Target Layout)

```
my-turborepo/
├── apps/
│   ├── web/          # Next.js 16 — user-facing UI (exists, early stage)
│   ├── api/          # Express + tRPC — core API server (NOT YET CREATED)
│   ├── ai-service/   # Vercel AI SDK — SQL generation (NOT YET CREATED)
│   ├── tre-dispatcher/ # BullMQ job dispatch (NOT YET CREATED)
│   └── tre-executor/   # DB execution worker (NOT YET CREATED)
├── packages/
│   ├── ui/           # Shared React components (exists)
│   ├── types/        # Shared Zod schemas + TypeScript types (NOT YET CREATED)
│   ├── auth/         # Keycloak OIDC + PASETO token helpers (NOT YET CREATED)
│   ├── db/           # Drizzle ORM schema + RLS + migrations (NOT YET CREATED)
│   ├── sql-validator/ # AST parsing, Cerbos decisions, row-filter injection (NOT YET CREATED)
│   ├── policy-client/ # Cerbos gRPC client wrapper (NOT YET CREATED)
│   ├── cerbos-policies/ # Cerbos .yaml policy files (NOT YET CREATED)
│   ├── audit/        # Hash-chain audit writer + verify-integrity (NOT YET CREATED)
│   ├── rate-limit/   # rate-limiter-flexible wrappers (NOT YET CREATED)
│   ├── eslint-config/ # Shared ESLint configs (exists)
│   └── typescript-config/ # Shared TS configs (exists)
├── infra/
│   ├── docker/       # docker-compose.yml for local dev (NOT YET CREATED)
│   ├── k8s/          # Helm charts / manifests (Phase 4)
│   └── terraform/    # IaC (Phase 5)
├── Docs/             # Full specifications (READ THESE)
├── CLAUDE.md         # This file
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript 5.9, Tailwind CSS, tRPC 11, TanStack Query 5, Zod 4 |
| Backend API | Express, TypeScript 5.9, tRPC 11, Zod 4, trpc-to-openapi (Scalar `/docs`) |
| Database (app) | PostgreSQL + Drizzle ORM, Row-Level Security on `org_id` |
| Identity | Keycloak (OIDC, off-the-shelf container) |
| Sessions/Tokens | PASETO (`v4.local` for sessions, `v4.public` for service-to-service) |
| Authorization | Cerbos (gRPC, attribute-based policy decision point) |
| AI | Vercel AI SDK, structured outputs via Zod, provider pattern |
| SQL Processing | node-sql-parser (AST), Cerbos decisions, row-filter injection |
| Job Queue | BullMQ + Redis |
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

All tables have `org_id` and PostgreSQL RLS policies enforcing tenant isolation at the database level.

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

| Phase | Focus | Key Deliverables |
|-------|-------|-----------------|
| P0 | Foundation | Repo structure, auth module, DB schema+RLS, Docker Compose |
| P1 | **The Differentiator** | Full SAFE/WARNING/CRITICAL pipeline, AI generation, validation, TRE (worker_threads), audit hash-chain — **fully demoable** |
| P2 | Governance | Multi-tenancy, custom-roles UI, approval workflow, multiple DB connections |
| P3 | Real Isolation | Container-based TRE, Vault dynamic secrets, separate dispatcher/executor apps |
| P4 | Cloud-Native | k8s deployment, k3s VPS, Vercel, CI/CD (GitHub Actions) |
| P5 | Observability | OpenTelemetry, Prometheus/Grafana, Loki, Sentry, Terraform, recorded demo |

**Current state: P0 scaffolding exists. Next: implement P0 packages then P1 pipeline.**

---

## Development Commands

```bash
pnpm dev          # start all apps in dev mode (Turborepo parallel)
pnpm build        # build all apps/packages
pnpm lint         # lint all
pnpm check-types  # TypeScript check all
```

Node >= 18 required. pnpm 9 required.

---

## Key Decisions (ADRs — Do Not Reverse Without Discussion)

- **PostgreSQL-only in v1** — covers Supabase, Neon, RDS, self-hosted
- **Keycloak not hand-rolled auth** — integrates with existing enterprise IdPs
- **PASETO not JWT** — eliminates algorithm-confusion attacks (`v4.local` encrypted sessions)
- **Cerbos not hand-rolled RBAC** — externalized, auditable, attribute-based
- **Custom roles as DB rows** — org admins configure without redeploy
- **Drizzle ORM** — SQL migrations as code, typed, RLS defined in schema
- **tRPC for internal APIs** — end-to-end type safety; trpc-to-openapi for external REST surface
- **No direct API→customer DB** — all execution through queue-based TRE
- **Hash-chain audit** — tamper-evident without blockchain operational overhead

---

## Coding Conventions

- TypeScript strict mode everywhere
- Zod for all validation at system boundaries (user input, external APIs, AI output)
- Pino for structured JSON logging — use redaction config to strip credentials
- All shared logic goes in `packages/` not duplicated in apps
- tRPC procedures in `apps/api/` — never define API logic in `apps/web/`
- Cerbos decisions are the authorization source of truth — never replicate logic in application code
- No raw SQL strings passed to database — always through Drizzle or parameterized pg queries

---

## Success Criteria (From PRD)

- 100% of analyst queries go through NL interface
- 0 blind executions (every query validated + logged)
- 0 destructive ops without CRITICAL approval flow
- 100% of state-changing actions in audit log
- Audit integrity check passes on demand; tampering detectable
- 0 cross-tenant data access incidents
- All four query paths (SAFE / WARNING / CRITICAL / SECURITY_INCIDENT) demoable end-to-end
