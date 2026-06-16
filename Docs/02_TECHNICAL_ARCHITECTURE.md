# SafeQuery — Technical Architecture Document (TAD)

**Document type:** Technical Architecture
**Product:** SafeQuery — Enterprise AI Database Governance Platform
**Status:** Draft v1.0
**Companion docs:** PRD, Security & Access Document, Feature Ticket List

---

## 1. Architectural Principles

1. **The core API never touches a customer database.** It orchestrates and enqueues; only the TRE executes. This single rule keeps credentials and blast radius confined.
2. **AI output is untrusted input.** Generated SQL is always parsed, validated, and rewritten before execution.
3. **Permissions are resolved live.** Tokens carry identity only; authorization is decided per request by a policy decision point (Cerbos), fed live context from the database.
4. **Each layer assumes the previous one failed.** Defense in depth, including a database-level backstop (RLS + grants).
5. **Shared logic lives in packages.** The same validator and executor logic is reused and independently tested rather than duplicated.
6. **Identity, authorization, and token security are three separate concerns.** Keycloak answers *who is this person* (identity + coarse role); Cerbos answers *is this allowed right now* (fine-grained, attribute-based decision); PASETO secures the *tokens that carry identity between services*. None of the three is hand-rolled.
7. **Custom roles are data, not policy.** Org admins create roles (e.g. "dev", "marketing", "analytics") with arbitrary names and capability sets as rows in the app database. Cerbos holds one generic, attribute-based policy set that is invariant across all orgs and roles. Adding a role never means writing or deploying policy.
8. **Execution tier is chosen by operation type.** Reads run on a warm pool of reused, isolated workers; approved writes run in fresh, ephemeral, single-use environments. Isolation is preserved in both; cold-start cost is paid only where it is negligible (writes already gated by approval latency).

---

## 2. System Context

```
            ┌─────────────┐
   Users ── │  Cloudflare │ ── edge rate limit / WAF / DNS
            └──────┬──────┘
                   ↓
            ┌─────────────┐  OIDC login  ┌──────────────┐
            │  web (Next) │ ───────────→ │   Keycloak    │ (identity / coarse roles / orgs)
            └─────┬───────┘              └──────────────┘
                  │ tRPC (PASETO v4.local session)
                  ↓
            ┌──────────────┐   checkResources   ┌──────────────┐
            │  api (Express)│ ─────────────────→ │ Cerbos (PDP)  │ (attribute-based decisions)
            └──────┬───────┘                    └──────────────┘
                   │ tRPC (PASETO v4.public)
       ┌───────────┼───────────────┐
       ↓           ↓                ↓
┌────────────┐ ┌─────────┐   ┌──────────────┐
│ ai-service │ │  Redis   │   │  App Postgres │
└────────────┘ │ (BullMQ) │   │  (Drizzle+RLS)│
               └────┬─────┘   └──────────────┘
                    ↓ job
            ┌────────────────┐
            │ tre-dispatcher  │ ── routes by operation type
            └───┬────────┬────┘
       read job │        │ approved-write job
                ↓        ↓
      ┌──────────────┐  ┌──────────────────┐   short-lived cred
      │ read pool     │  │ ephemeral write   │ ←──── Vault
      │ (warm workers)│  │ executor (one-shot)│
      └──────┬───────┘  └─────────┬─────────┘
             ↓ pg (read-only)     ↓ pg (dry-run→commit)
            ┌─────────────────────────────┐
            │      Customer DB(s)          │
            └─────────────────────────────┘
```

---

## 3. Services (Multi-Server Architecture)

| Service | Runtime | Responsibility | Scales on |
|---------|---------|----------------|-----------|
| `apps/web` | Next.js + TS | Chat UI, admin dashboard, policy editor, approval queue | CDN / edge |
| `apps/api` | Express + TS | OIDC token validation, session minting, orgs/roles CRUD, Cerbos calls, pipeline orchestration, `/docs` | Stateless replicas |
| `apps/ai-service` | TS + Vercel AI SDK | Text-to-SQL (structured), prompt-injection screen, risk scoring, simulation | LLM call volume |
| `apps/tre-dispatcher` | TS + BullMQ | Consumes execution queue; routes read vs. approved-write jobs to the right execution tier | Queue depth |
| `apps/tre-executor` | Minimal TS image | The only component that touches customer DBs; runs as warm-pool worker (reads) or one-shot job (writes) | Pool replicas / per-write |
| **Keycloak** | Off-the-shelf container | Identity provider: signup/login, password/MFA, sessions, organizations, coarse role assignment via OIDC | Managed separately |
| **Cerbos** | Off-the-shelf container | Policy decision point: evaluates one generic attribute-based policy set; returns allow/deny + outputs (row filter, masked columns) | Sidecar / service |

**Communication matrix**

| From → To | Transport | Auth |
|-----------|-----------|------|
| web → Keycloak | OIDC (browser redirect) | — |
| web → api | tRPC over HTTPS | PASETO `v4.local` session (minted by api after OIDC) |
| api → Keycloak | OIDC token validation (JWKS) / admin REST | client credentials |
| api → Cerbos | gRPC/HTTP `checkResources` | local/sidecar trust |
| api → ai-service | tRPC / in-process | PASETO `v4.public` |
| api → tre-dispatcher | BullMQ over Redis | Signed job payload |
| tre-dispatcher → tre-executor (pool) | warm worker, BullMQ concurrency | rotated leased cred |
| tre-dispatcher → tre-executor (write) | one-shot worker_thread / container / k8s Job | single-use cred |
| tre-executor → customer DB | `pg` wire protocol | Short-lived DB credential |
| results → web | Redis pub/sub or short-poll | Session-scoped |

---

## 4. Monorepo Layout (Turborepo)

```
safequery/
├── apps/
│   ├── web/              # Next.js
│   ├── api/              # Express + tRPC server + Scalar /docs
│   ├── ai-service/       # generation, prompt firewall, risk, simulation
│   ├── tre-dispatcher/   # BullMQ consumer, read/write routing
│   └── tre-executor/     # minimal execution image (pool worker + one-shot)
├── packages/
│   ├── types/            # shared Zod schemas / TS types
│   ├── auth/             # PASETO local+public, Keycloak OIDC validation, admin-client wrapper
│   ├── policy-client/    # typed Cerbos checkResources wrapper
│   ├── cerbos-policies/  # generic attribute-based policy YAML bundle (per-product, not per-org)
│   ├── sql-validator/    # node-sql-parser AST + Cerbos-decision application + rewrite
│   ├── audit/            # hash-chain helpers + verify
│   ├── db/               # Drizzle schema (incl. custom_roles), RLS, migrations
│   ├── rate-limit/       # rate-limiter-flexible configs
│   ├── ui/               # shared React components
│   └── config/           # eslint / tsconfig
├── infra/
│   ├── docker/           # incl. keycloak + cerbos compose services
│   ├── k8s/              # Helm charts / manifests
│   └── terraform/
└── turbo.json
```

Turborepo provides one `turbo dev` for local orchestration and incremental build/test caching so CI only rebuilds changed apps. Shared packages enforce a single source of truth for types, validation, and audit logic.

---

## 5. Request Flow (Detailed)

### 5.1 Query generation & validation (in `api` + `ai-service`)

```
web → api.query.submit(prompt)        [browser already logged in via Keycloak OIDC]
  ├─ api: verify PASETO local session token → user_id, session_id
  ├─ api: live lookup → org membership, custom_role row, department, environment
  ├─ api: resolve custom_role → flat principal attributes
  │        { roles:["org_member"], capabilities, tableScope, rowFilterTemplate, orgId }
  ├─ api → ai-service.generate(prompt, filteredSchema, policyContext)
  │     ├─ sanitize prompt
  │     ├─ prompt-injection screen  → if positive: SECURITY_INCIDENT
  │     ├─ generateObject(Zod schema) → { sql, explanation, riskHint }
  │     └─ return structured result
  ├─ api → sql-validator.validate(sql, principalAttrs)
  │     ├─ parse to AST (node-sql-parser) → extract tables, columns, statement type
  │     ├─ for each (table, action): Cerbos checkResources(principal, resource=db_table, action)
  │     │      → ALLOW/DENY  + outputs { rowFilter, maskedColumns }
  │     ├─ deny any table/column/action Cerbos refused
  │     ├─ multi-statement / forbidden-op / missing-LIMIT / join-complexity checks
  │     └─ rewrite: inject Cerbos-returned rowFilter into WHERE
  ├─ api: risk engine → SAFE | WARNING | CRITICAL | SECURITY_INCIDENT
  └─ branch (see 5.2)
```

> **Authorization split:** `node-sql-parser` extracts *what the query touches* (tables, columns, statement type); Cerbos decides *whether it's allowed* given the principal's attributes. The validator turns Cerbos's allow/deny into the allowlist and its `outputs` into the row filter and masked-column list. No bespoke rules engine.

### 5.2 Risk branch

```
SAFE              → enqueue READ job (→ warm pool)
WARNING           → return to user for acknowledgment → enqueue READ job on ack
CRITICAL (write)  → dry-run (BEGIN…RETURNING…ROLLBACK) → create approval_request with exact
                    affected rows → notify reviewer → on approval enqueue WRITE job (ephemeral)
SECURITY_INCIDENT → reject, write security audit event, no enqueue
```

### 5.3 Execution — two tiers (in TRE)

```
tre-dispatcher: consume job from BullMQ, route by { readOnly }
│
├─ readOnly:true  → WARM READ POOL
│     pool worker (long-lived, isolated, lease-renewed cred):
│       ├─ open per-job transaction: SET TRANSACTION READ ONLY; SET statement_timeout
│       ├─ run via pg-cursor, fetch up to policy row cap
│       ├─ apply PII masking per Cerbos maskedColumns (BEFORE results leave)
│       ├─ ROLLBACK (read txn closed); connection returned to pool
│       └─ append audit entry (hash chain)
│
└─ readOnly:false → EPHEMERAL WRITE EXECUTOR (approved writes only)
      fresh one-shot unit (single-use cred, destroyed after):
        ├─ open transaction: SET lock_timeout, SET statement_timeout
        ├─ run validated write with RETURNING *  (re-confirms affected rows)
        ├─ COMMIT  (this commit IS "reflecting the change in the main DB")
        ├─ append audit entry (hash chain, incl. approver id)
        └─ teardown / destroy environment
results → Redis pub/sub → web
```

> **Why two tiers:** spinning a fresh environment per *read* wastes 1–3s of cold-start on the most frequent, lowest-risk traffic. Reads get a warm pool (isolation from read-only txn + caps + rotated lease, not from a new container). Writes — rare, already waiting on minutes of approval latency — pay cold-start for maximum isolation. **No "copy data then merge" step:** the dry-run uses transactional `ROLLBACK` for an exact preview, and the post-approval `COMMIT` is the single source of truth. Concurrency is handled by Postgres MVCC + row locks + `lock_timeout`, not custom logic.

---

## 6. AI Subsystem

- **Provider pattern** over OpenAI-compatible APIs; provider is swappable without touching callers.
- **Structured output** via Vercel AI SDK `generateObject` with a Zod schema from `packages/types` — SQL, explanation, and risk hint arrive as typed fields.
- **Schema filtering**: only the user's permitted tables/columns are described to the model. Reduces both data exposure and hallucination.
- **Prompt-injection screen**: a fast pre-pass (heuristic signatures + a small classification call). Positive → `SECURITY_INCIDENT`, no generation proceeds.
- The model **never** receives credentials, full schema, or org secrets, and its output **never** executes directly.

---

## 7. Validation & Authorization Subsystem

Two cooperating pieces: `packages/sql-validator` (understands SQL) and Cerbos via `packages/policy-client` (decides permission). Neither does the other's job.

**`packages/sql-validator`**
- Parser: **`node-sql-parser`** (Postgres dialect v1; MySQL dialect added in Phase 2 with no rewrite).
- Extracts referenced tables, columns, and statement type from the AST (`tableList`/`columnList`).
- Structural checks it owns outright: multi-statement detection, forbidden operations (DDL, system tables), missing `LIMIT`, join complexity.
- **Applies Cerbos decisions:** for each (table, action) it asks Cerbos; a DENY fails validation, an ALLOW contributes to the allowlist, and the rule's `outputs` provide the row filter and masked-column list.
- **Row-filter injection:** rewrites the AST `WHERE` to add the Cerbos-returned `rowFilter` — never trusting the model to include it.
- Pure, deterministic, unit-tested against an adversarial corpus.

**Cerbos (policy decision point)**
- One **per-product** policy bundle in `packages/cerbos-policies` — *not* per-org and *not* per-role. A single `db_table` resource policy plus derived roles encode the invariants (org-scoping, capability check, production-write-needs-approval, PII masking) that hold for every tenant.
- **Custom roles are data:** org admins create roles ("dev", "marketing", "analytics") as rows in `custom_roles` with arbitrary names + capability arrays. At request time `api` flattens the user's role into principal attributes (`capabilities`, `tableScope`, `rowFilterTemplate`, `orgId`) and passes them to Cerbos. A new role = a new row, never a policy change or redeploy.
- Cerbos `outputs` return the structured `rowFilter` and `maskedColumns` the validator and executor consume.
- Policies are version-controlled YAML, tested with Cerbos's own test framework — same "policy as code" ethos as Drizzle RLS.

> **Example invariant (cannot be weakened by naming a role cleverly):** a DENY rule blocks `update`/`delete` against a `production` environment whenever `approvalStatus != "approved"`, regardless of the principal's capabilities. This is exactly the kind of platform guarantee that justifies an external PDP over an in-code capability check.

---

## 8. Execution Subsystem (TRE) — Two Tiers, Phased

Execution is split by operation type. Both tiers share the same core executor logic (`connect → harden → run → mask → audit → teardown`); they differ in lifecycle and credential model.

**Read tier — warm pool**
- Long-lived, isolated worker replicas (k8s `Deployment`, autoscaled on queue depth).
- Per-job isolation from: a `SET TRANSACTION READ ONLY` transaction opened/closed per job, `statement_timeout`, `pg-cursor` row caps.
- Credential is a Vault lease **renewed on a short cycle** (not minted per query), capped TTL, revoked on pod restart — short-lived, least-privilege, amortized.
- Same locked-down network segment as writes (egress: DB + Redis only).

**Write tier — ephemeral, approved writes only**
- Fresh one-shot unit per approved write (worker_thread → container → k8s `Job` across phases).
- **Single-use** Vault credential; environment destroyed after `COMMIT`.
- Used twice per approved write: once for the **dry-run preview** (`BEGIN … RETURNING * … ROLLBACK`, exact affected rows, nothing committed) shown to the reviewer, and once post-approval to `COMMIT` the same validated SQL.
- `lock_timeout` + `statement_timeout` set; concurrency handled by Postgres MVCC/row locks (no custom logic).

| Phase | Read tier | Write tier | Isolation property |
|-------|-----------|------------|--------------------|
| 1 | In-process worker (BullMQ + `worker_threads`) | Same, single-use txn | Logical; proves the pipeline + dry-run/commit |
| 2 | Pool of reused container workers | Ephemeral container per write (`dockerode`) | Process + network isolation |
| 3 | `Deployment` of pool pods, autoscaled | One-shot k8s `Job` per write | Pod isolation, `NetworkPolicy`, hardened `PodSecurityContext`, resource limits, TTL cleanup |

**Future research (not built):** Firecracker microVMs, gVisor, Nitro Enclaves.

**TRE network posture:** executors (both tiers) have no internet egress — only Redis (jobs) and target databases (via leased/JIT credentials) are reachable.

---

## 9. Data Layer

### App database — Drizzle ORM + PostgreSQL

- `drizzle-kit` migrations are plain, reviewable SQL.
- `pgPolicy` (RLS) and `pgRole` defined in-schema → multi-tenant isolation and reader/writer DB roles are version-controlled code.
- RLS keyed on `org_id` across all tenant-scoped tables.

### Core tables

| Table | Notes |
|-------|-------|
| `organizations` | Tenants (mirror Keycloak organizations) |
| `users` | Identity mirror keyed to Keycloak subject; no local password (Keycloak owns auth) |
| `organization_members` | user ↔ org + `custom_role_id` + department |
| `custom_roles` | **admin-defined roles as data:** `org_id`, `name`, `capabilities[]`, `table_scope[]`, `column_restrictions` jsonb, `row_filter_template`, `environments[]` |
| `invitations` | pending invites (delegated to Keycloak where possible) |
| `environments` | dev / staging / prod per org |
| `database_connections` | non-sensitive config + opaque credential reference |
| `schema_snapshots` | discovered metadata for the AI |
| `policies` | org-tunable knobs read into Cerbos principal/resource attrs (PII columns, time windows, rate limits) |
| `query_logs` | generated + final SQL, status, risk, result summary |
| `approval_requests` | requester, SQL, dry-run affected rows, reviewer, status |
| `audit_logs` | hash-chained immutable events |

> **Auth split reflected here:** Keycloak owns credentials/sessions/MFA; the `users` row is a local mirror keyed on the Keycloak subject id. `custom_roles` + `organization_members` are the data that gets flattened into Cerbos principal attributes per request.

### Target customer databases

Accessed only by `tre-executor` via raw `pg` + `pg-cursor` (dynamic, unowned schemas — Drizzle is not used here).

### Caching / queue / secrets

- **Redis**: BullMQ queue, rate-limit counters, results pub/sub.
- **Vault** (Phase 3): database secrets engine issues short-lived Postgres roles.

---

## 10. API & Type Strategy

- **tRPC** for `web ↔ api` and intra-monorepo service calls → end-to-end type inference.
- **`trpc-to-openapi`** generates an OpenAPI 3.1 document from procedures annotated with `meta.openapi` and Zod schemas.
- **Scalar** (`@scalar/express-api-reference`) serves the doc at `/docs` for platform endpoints (policy, org/user, audit, approvals).
- Query-execution endpoints remain internal tRPC only (not publicly documented).

---

## 11. Identity, Authorization & Service Trust

Three separate concerns, three separate tools:

- **Identity — Keycloak.** Signup, login, password reset, MFA, sessions, and organizations are handled by Keycloak via OIDC. The browser authenticates against Keycloak; SafeQuery never stores passwords. Keycloak issues coarse role/org claims. `api` validates the OIDC token against Keycloak's JWKS and provisions users/orgs via the admin REST client. Enterprise story: SafeQuery integrates with an existing IdP rather than reinventing login.
- **Session/service tokens — PASETO.** After OIDC validation, `api` mints a **PASETO `v4.local`** session token (`{ user_id, session_id }`) that the browser holds — keeping Keycloak tokens out of the frontend and giving immediate server-side revocation. Service-to-service calls use **PASETO `v4.public`** (Ed25519): `api` signs, `ai-service`/`tre-dispatcher` verify. Key rotation via `kid`.
- **Authorization — Cerbos.** Every request resolves the user's live org/custom-role/department, flattens it into principal attributes, and asks Cerbos `checkResources`. Cerbos returns allow/deny + outputs. Permissions are never baked into any token; a role change takes effect on the next request. Custom roles are app-DB rows, not Cerbos policy (see §7).

Full model in the Security & Access Document.

---

## 12. Audit Subsystem (`packages/audit`)

- Append-only `audit_logs`; each row: `hash = SHA256(previous_hash + canonical_json(event))`.
- Events: login, generation, validation, execution, approval/rejection, policy change, security incident.
- `verify-integrity` recomputes the chain from genesis and flags the first mismatched row.

---

## 13. Rate Limiting

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| Edge | Cloudflare rules | Per-IP |
| Application | `rate-limiter-flexible` + Redis | Per-user, per-org (policy-configurable) |
| Queue | BullMQ concurrency limiter | Per-org concurrent executions (protects customer DB) |

Configs shared via `packages/rate-limit` across `api` and `tre-dispatcher`.

---

## 14. Deployment Topology

| Environment | Topology |
|-------------|----------|
| **Local** | Docker Compose: app Postgres, 2–3 seeded customer Postgres (dev/staging/prod), Redis, Vault dev mode, **Keycloak**, **Cerbos** (policies mounted from `packages/cerbos-policies`); `turbo dev` for Node apps |
| **Deployed** | `web` on Vercel; `api` / `ai-service` / `tre-dispatcher` / `tre-executor` (read `Deployment` + write `Job`) on single-node **k3s** VPS; **Cerbos as a sidecar to `api`**; **Keycloak** in-cluster (or managed); managed Postgres (app DB); customer demo DBs as in-cluster StatefulSets; managed Redis (Upstash); in-cluster Vault; Cloudflare edge |

Manifests/Helm charts generalize to EKS/GKE.

---

## 15. CI/CD & IaC

- **GitHub Actions:** `turbo lint + test` (changed apps only) → Docker build → **Trivy** scan → push images → deploy via `kubectl`/Helm.
- **Terraform** (later phase): VPS, DNS records, firewall rules.

---

## 16. Observability

- **OpenTelemetry** tracing across services.
- **Prometheus + Grafana**: query volume by risk, approval-queue latency, worker error rate, execution duration, TRE health, queue length, LLM usage.
- **Loki** logs; **Sentry** errors; **Pino** structured JSON logs with credential redaction.

---

## 17. Key Architectural Decisions (ADR Summary)

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-1 | Core API never connects to customer DBs | Confine credentials + blast radius to TRE |
| ADR-2 | PASETO over JWT (sessions + service-to-service) | Encrypted payloads; eliminates `alg` confusion attacks |
| ADR-3 | Drizzle over Prisma | Reviewable SQL migrations; RLS/roles as code |
| ADR-4 | tRPC + `trpc-to-openapi` + Scalar | Type safety internally, documented REST externally |
| ADR-5 | Hash chain over blockchain | Tamper-evidence without operational overhead |
| ADR-6 | Two-tier TRE (warm read pool + ephemeral write executor), shared executor | Avoid cold-start on frequent reads; max isolation on rare writes |
| ADR-7 | Row-filter injected by validator from Cerbos outputs | Never trust the model to enforce permissions |
| ADR-8 | Postgres-only v1 | Covers Supabase/Neon/RDS; unlocks RLS story; adapter interface for later dialects |
| ADR-9 | Turborepo | Folder structure mirrors service architecture; CI caching |
| ADR-10 | Keycloak for identity (OIDC) | Don't hand-roll signup/login/MFA/sessions; integrate with existing IdPs |
| ADR-11 | Cerbos for authorization | Externalized, attribute-based PDP; policy as code; decouples decisions from app code |
| ADR-12 | Custom roles as data, Cerbos policy per-product | New roles = DB rows, never YAML/redeploy; invariants stay in one generic policy set |
| ADR-13 | Dry-run-then-commit for writes (no copy/merge) | Exact preview via transactional ROLLBACK; COMMIT is the single source of truth; MVCC handles concurrency |
