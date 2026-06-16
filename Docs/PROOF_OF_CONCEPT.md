# SafeQuery — Proof of Concept

**Enterprise AI Database Governance Platform**

> The security and governance layer that sits between an LLM and a real database.
> Not an AI SQL chatbot — a control plane that proves AI-generated SQL is safe (or gets a human to approve it), executes it under the tightest possible constraints, and produces an unforgeable record of what happened.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Why SafeQuery Exists](#2-why-safequery-exists)
3. [Core Philosophy](#3-core-philosophy)
4. [What This Project Demonstrates](#4-what-this-project-demonstrates)
5. [Users, Roles & Tenancy](#5-users-roles--tenancy)
6. [Database Connectivity Strategy](#6-database-connectivity-strategy)
7. [Secret Management Strategy](#7-secret-management-strategy)
8. [The Query Lifecycle (End to End)](#8-the-query-lifecycle-end-to-end)
9. [The AI Pipeline](#9-the-ai-pipeline)
10. [The Validation Engine](#10-the-validation-engine)
11. [The Risk Engine](#11-the-risk-engine)
12. [Query Simulation](#12-query-simulation)
13. [Approval Workflow](#13-approval-workflow)
14. [The Trusted Runtime Environment (TRE)](#14-the-trusted-runtime-environment-tre)
15. [Audit System (Hash-Chain)](#15-audit-system-hash-chain)
16. [Policy Engine](#16-policy-engine)
17. [Authentication & Authorization (PASETO)](#17-authentication--authorization-paseto)
18. [API Surface (tRPC + Scalar)](#18-api-surface-trpc--scalar)
19. [Rate Limiting & Throttling](#19-rate-limiting--throttling)
20. [Defense-in-Depth Security Model](#20-defense-in-depth-security-model)
21. [Multi-Server Architecture](#21-multi-server-architecture)
22. [Monorepo Strategy (Turborepo)](#22-monorepo-strategy-turborepo)
23. [Data Model](#23-data-model)
24. [Cloud & Deployment Strategy](#24-cloud--deployment-strategy)
25. [Observability](#25-observability)
26. [Technology Stack (Final)](#26-technology-stack-final)
27. [Phased Build Plan (0 → 100)](#27-phased-build-plan-0--100)
28. [Threat Model](#28-threat-model)
29. [Demo Script](#29-demo-script)
30. [Future Research (Explicitly Out of Scope)](#30-future-research-explicitly-out-of-scope)
31. [Success Criteria](#31-success-criteria)

---

## 1. Executive Summary

Organizations increasingly let employees use LLMs to write SQL. The de-facto workflow today is dangerous:

```
Employee → ChatGPT/Claude → copy generated SQL → paste into production DB → potential disaster
```

There is no validation, no permission enforcement, no approval step, no audit trail, and database credentials end up widely distributed. SafeQuery replaces that workflow with a governed control plane.

A user asks a question in plain English ("show top customers by revenue"). SafeQuery generates SQL, treats it as untrusted, validates it against the user's permissions and the organization's policies, scores its risk, simulates its impact, routes risky operations through human approval, executes only inside an isolated runtime with short-lived credentials, masks sensitive output before it leaves the boundary, and records every step in a tamper-evident hash chain.

**This document is the complete specification.** Nothing in it is left to "figure out later" — where a decision is deferred to a later phase, the upgrade path is named explicitly.

> **Stack decisions (read first).** Identity/authentication is delegated to **Keycloak** (OIDC) — SafeQuery stores no passwords. Authorization is delegated to **Cerbos**, an external policy decision point, fed live context per request. **PASETO** secures session and service-to-service tokens only. **Custom roles are application data, not policy:** org admins create arbitrarily-named roles with capability sets as database rows; Cerbos holds one generic, per-product policy set that never changes per org or per role. **Execution is two-tiered:** reads run on a warm pool of isolated workers; approved writes run in fresh ephemeral environments using a transactional **dry-run-then-commit** flow (no data copy/merge). These supersede any contrary detail later in this document where older phrasing remains.

---

## 2. Why SafeQuery Exists

### The problems with the current state

- AI-generated SQL cannot be trusted — it can hallucinate table names, omit `WHERE` clauses, or be manipulated via prompt injection.
- Employees may accidentally execute destructive queries (`DELETE` without a filter, `DROP`, `TRUNCATE`).
- There is no approval workflow for elevated or destructive actions.
- There is no audit trail of who ran what, when, and with whose approval.
- Database credentials get copied into scripts, notebooks, and chat tools.
- Sensitive data (PII) flows back to users with no masking.
- Existing AI-SQL tools optimize for **convenience**, not **governance**.

### What SafeQuery is and is not

| It is NOT | It IS |
|-----------|-------|
| An AI SQL chatbot | A governance + execution control plane |
| A BI dashboard | A policy-driven validation layer |
| A database client | An isolated, auditable execution boundary |

SafeQuery optimizes for **trust**: faster data access *with* security, governance, compliance, auditability, and human oversight intact.

---

## 3. Core Philosophy

Four principles drive every architectural decision. Any feature that doesn't make the AI→database boundary safer or more observable doesn't belong in the project.

1. **Never trust AI output.** LLM-generated SQL is untrusted input. Every query is parsed, validated, and rewritten before it can run.
2. **Execute nothing without controls.** Policies determine what can execute. High-risk operations require human approval.
3. **Assume compromise.** Every layer is designed assuming the previous layer failed. Security is defense in depth, not a single gate.
4. **Reduce blast radius.** The execution layer is isolated, credentials are short-lived, and no single component has unrestricted access.

---

## 4. What This Project Demonstrates

SafeQuery is deliberately scoped to showcase a full breadth of senior-level engineering skills in one coherent system:

| Pillar | Demonstrated by |
|--------|-----------------|
| **Full-stack engineering** | Next.js + TypeScript + Tailwind frontend; Express + TypeScript backend; tRPC end-to-end types |
| **AI engineering** | Schema-aware text-to-SQL, structured LLM outputs (Zod), prompt-injection detection, multi-provider gateway, SQL explanation |
| **Security engineering** | Keycloak (OIDC), Cerbos (policy-as-code authz), PASETO, Postgres RLS, AST validation, prompt firewall, hash-chain audit logs, secret management, zero-trust execution |
| **Cloud & DevOps** | Docker, Kubernetes, GitHub Actions CI/CD, Terraform (IaC), Cloudflare edge |
| **Distributed systems** | Background workers, Redis/BullMQ queues, warm execution pool + ephemeral write workers, multi-service architecture, multi-tenant isolation |
| **Observability** | OpenTelemetry, Prometheus, Grafana, Loki, Sentry, structured logging |

---

## 5. Users, Roles & Tenancy

Each customer is an **organization** (tenant). There are two layers of roles.

**Built-in platform roles** (carried in Keycloak) govern SafeQuery's own surfaces:

| Role | Responsibilities |
|------|------------------|
| **Owner** | Workspace setup, billing, org-level governance, full access |
| **Admin** | Member management, custom-role creation, database connections, policy definition, environment configuration |
| **Reviewer** | Approves/rejects elevated and destructive requests; reviews risk + dry-run reports |
| **Analyst** | Asks business questions in natural language; runs queries within their scope |
| **Viewer** | Views results and dashboards; cannot run new queries |

**Custom roles** are what admins actually use to control database access, and they are **data, not policy**. An admin creates a role with any name and capability set — "dev" = full CRUD on a table group, "marketing" = view-only, "analytics" = read+edit — as a row in `custom_roles`, through the admin UI, with no code change and no redeploy. A brand-new org with three brand-new roles is just three rows.

**Permissions are never stored in any token.** Every request resolves the caller's current org membership, custom role, and department with a **live database lookup**, flattens that into principal attributes, and asks **Cerbos** for the decision. Benefits: immediate revocation (an admin removing access takes effect on the very next request), centralized authorization, and a single source of truth.

**Tenant isolation** is enforced at the database level via Postgres Row-Level Security keyed on `org_id` — the same technique SafeQuery sells to its customers, applied to its own control-plane data. No tenant can read another tenant's users, policies, audit logs, database connections, query history, or approval workflows.

---

## 6. Database Connectivity Strategy

### How "the user's database" works

For a portfolio project, the connected databases are **your own seeded instances** — but the code path is identical to a real enterprise connecting their database, which is the point. An org admin goes to **Settings → Database Connections → Add Connection** and enters host, port, database name, username, password (or a full connection URI) and SSL requirements.

On submission, SafeQuery:

```
Connection request
    ↓
Credential encryption
    ↓
Secret storage
    ↓
Connectivity test
    ↓
Metadata discovery (information_schema)
    ↓
Schema snapshot creation
```

The **schema snapshot** (tables, columns, types, relationships) — *not* a live connection — is what gets fed to the AI later. Only metadata is ever exposed to the LLM; credentials never leave the execution boundary.

### Supported databases by phase

| Phase | Databases | Notes |
|-------|-----------|-------|
| **1** | PostgreSQL only | Covers self-hosted Postgres, AWS RDS, **Supabase**, and **Neon** automatically — they all speak the Postgres wire protocol and use the `pg` driver. Differences are connection-string shape and pooling (Supabase pooler endpoint; Neon pooled vs. direct), handled by a thin adapter, not a new code path. Postgres-only also unlocks RLS + role grants, which are core to the security story. |
| **2** | MySQL, PlanetScale | `mysql2` driver. `node-sql-parser` already supports the MySQL dialect, so the validator needs no rewrite. |
| **3** | Snowflake, BigQuery | Out of MVP scope. |

**SQLite** is deliberately excluded from the security narrative (no server-side roles or RLS, so the isolation story doesn't apply), but may be offered as an explicitly-labeled "instant demo mode" sandbox for visitors who don't want to set up Postgres.

The connector layer is an **adapter interface**: adding a dialect means implementing one driver adapter plus one parser dialect — nothing else changes.

---

## 7. Secret Management Strategy

Connection records are split: non-sensitive config (host, port, db name, SSL mode, db type) lives in plain columns; **credentials get the protection.** Built in two stages, where the upgrade path is itself a talking point.

### Phase 1 — Application-layer envelope encryption

- On submission, encrypt credentials with **AES-256-GCM** (Node's built-in `crypto`).
- The data key is itself encrypted by a master key held **only by the execution side** of the system — never by the core API.
- Store ciphertext + IV + auth tag in Postgres; the core API holds only an opaque reference ID.
- Use **`pino` with redaction paths** so credentials can never accidentally appear in a log line.

### Phase 3 — HashiCorp Vault dynamic secrets

- Replace envelope encryption with Vault's **database secrets engine**.
- Vault is given each target database's admin credentials **once**; from then on it mints a brand-new, time-limited Postgres role on demand for every execution.
- This is true **zero standing privileges**, and it's the mechanism that powers the TRE credential step.
- `node-vault` is the official Node client — fits the stack.

**Rule:** the core API never holds a usable database credential at any point. It holds a reference; the execution boundary resolves it.

---

## 8. The Query Lifecycle (End to End)

The complete journey of a single natural-language question:

```
0.  User is logged in via Keycloak (OIDC); browser holds a PASETO session token
1.  User types a question in the chat UI (+ PASETO session token)
2.  api resolves live org/custom-role/department (DB lookup) → principal attributes
3.  Prompt sanitization + prompt-injection screen
4.  Schema filtered to the user's permitted tables/columns
5.  ai-service generates structured SQL + explanation + risk hint
6.  sql-validator parses to AST; per (table, action) asks Cerbos → allow/deny + outputs;
    rewrites WHERE with the Cerbos-returned row filter
7.  Risk engine classifies: SAFE | WARNING | CRITICAL | SECURITY_INCIDENT
8.  Branch:
      SAFE              → enqueue READ job (warm pool)
      WARNING           → user acknowledgment → enqueue READ job
      CRITICAL (write)  → transactional dry-run (exact affected rows) → reviewer approval
                          (re-auth) → enqueue WRITE job (ephemeral) / reject
      SECURITY_INCIDENT → hard reject, no approval path, logged as security event
9.  api enqueues the job on BullMQ (never touches the customer DB itself)
10. tre-dispatcher routes: read → warm pool worker; approved write → fresh ephemeral unit
11. Reads run read-only + statement_timeout + row cap; writes run validated SQL +
    RETURNING * and COMMIT (single-use credential)
12. Executor masks PII per Cerbos maskedColumns BEFORE results leave the boundary
13. Write unit tears down (single-use cred); pool worker returns to the pool
14. Every step appended to the hash-chain audit log
15. Result + SQL + execution metadata + approval info returned to the user
```

---

## 9. The AI Pipeline

```
Natural language prompt
    ↓
Prompt sanitization
    ↓
Prompt-injection detection   ← fast, cheap classification (heuristics + small model call)
    ↓
Schema filtering             ← only the user's permitted tables/columns
    ↓
LLM gateway                  ← provider pattern, OpenAI-compatible APIs
    ↓
Structured SQL generation    ← Vercel AI SDK generateObject + Zod schema
    ↓
SQL explanation generation
```

**The LLM only ever receives:** allowed schemas, allowed tables, allowed columns, table/column descriptions, and organizational policy context.

**The LLM never receives:** database credentials, full database visibility, or organizational secrets.

Schema filtering is not only a security control — by never telling the model about tables it isn't allowed to touch, it also **reduces hallucination**, because the model can't reference what it's never seen.

Output is **structured** (`generateObject` with a Zod schema shared from `packages/types`), not free text — so the SQL, explanation, and risk hint arrive as typed fields, not something to regex out of prose. The gateway uses a **provider pattern** so the model can be swapped (or a self-hosted model added later) without touching callers.

---

## 10. The Validation Engine

Generated SQL is treated as untrusted input. **Never trust the model to enforce permissions.** Two cooperating pieces: `sql-validator` understands SQL; **Cerbos** decides permission.

```
Generated SQL
    ↓
node-sql-parser → AST (extract tables, columns, statement type)
    ↓
Cerbos checkResources per (table, action) → allow/deny + outputs
    ↓
Automatic query rewriting   ← inject Cerbos-returned row filter into WHERE
    ↓
Risk classification (handoff)
```

Structural checks the validator owns:

- **Statement type** — extracted from the AST and passed to Cerbos as the action.
- **Multi-statement detection** — reject anything with stacked statements (`;`).
- **Missing `LIMIT` detection** — flag unbounded result sets.
- **Join complexity** — flag excessive joins (cost + data-exposure signal).
- **Forbidden operations** — `DROP`, `TRUNCATE`, `ALTER`, system-table access.

Authorization decided by Cerbos:

- **Allowed tables / columns / actions** — every referenced object becomes a Cerbos resource+action; a DENY fails validation.
- **Row-filter injection** — the validator injects the `rowFilter` returned in Cerbos `outputs` (e.g. `department = :user_department`) into the AST `WHERE`, rather than trusting the model. Closes the single most common text-to-SQL security hole.
- **Masked columns** — Cerbos `outputs` also return the `maskedColumns` list the executor applies before results leave.

This logic lives in **`packages/sql-validator`** (+ a typed Cerbos wrapper in `packages/policy-client`), independently unit-tested with adversarial inputs alongside Cerbos's own policy tests.

---

## 11. The Risk Engine

Routes a validated query by severity. Thresholds are **configurable per org** (org knobs read into Cerbos/risk attributes), not hardcoded.

| Level | Examples | Action |
|-------|----------|--------|
| **SAFE** | `SELECT`, limited reports, read-only within row cap | Execute automatically (warm read pool) |
| **WARNING** | Sensitive-table access, large scans, missing `LIMIT` | Require user acknowledgment, then execute |
| **CRITICAL** | `DELETE`, `TRUNCATE`, any write against production | Dry-run → reviewer approval (with re-auth) → ephemeral write executor / reject |
| **SECURITY_INCIDENT** | Prompt-injection signatures, forbidden-table access, privilege-escalation attempts | **Immediate rejection. No approval path exists.** Logged as a security event. |

The crucial design decision: **`SECURITY_INCIDENT` and `CRITICAL` are different branches.** A user legitimately needing elevated access is a normal elevation request and goes to the approval queue. An attack attempt is hard-rejected with no path to approval — you never want reviewers rubber-stamping injection attempts.

---

## 12. Query Simulation (Dry-Run)

Before any execution (and shown to reviewers during approval):

```
Reads:   EXPLAIN plan → estimated rows / cost
Writes:  BEGIN → run validated write with RETURNING * → ROLLBACK
         → EXACT rows that would change, nothing committed
```

For a `SELECT`, this is an `EXPLAIN` plan with estimated rows/cost. For an `UPDATE`/`DELETE`, the executor runs the **actual write inside a transaction with `RETURNING *`, then `ROLLBACK`s** — so the reviewer sees the *exact* rows that would change, not an estimate, and production is untouched because nothing was committed. **No data is copied and nothing is merged later:** on approval, the same validated SQL re-runs and `COMMIT`s, and that commit is the change reaching production.

---

## 13. Approval Workflow

```
User submission
    ↓
Pending approval queue
    ↓
Reviewer analysis
    ↓
Approve / reject (reviewer re-authenticates)
    ↓
Audit logging
    ↓
Execution authorization
```

The reviewer's screen shows: the original natural-language prompt, the generated SQL, the risk assessment, the simulation results, and the estimated impact. Approval requires the reviewer to **re-authenticate** (a fresh credential check), and the approver's identity is recorded in the audit entry that accompanies the resulting execution.

---

## 14. The Trusted Runtime Environment (TRE)

### Purpose — the core of the project

The TRE is the **single chokepoint** where AI-generated SQL ever touches a real database. Its job is threefold:

1. **Nothing outside the TRE ever holds DB credentials.** The core API never imports `pg` and never opens a connection to a customer database — it only enqueues a job and waits for a result. That single rule makes the whole design coherent.
2. **Every execution is time-boxed and resource-capped,** with a credential that's already expired by the time anyone could misuse it.
3. **Results are masked before they leave.** The boundary controls both *what runs* and *what data exits* — this is what makes it a Trusted Runtime Environment, not merely a sandbox.

### Without vs. with TRE

```
Without TRE:   API → Database          (API holds creds, unbounded blast radius)

With TRE:      API → Redis Queue → TRE → Database   (API holds nothing; TRE is the only DB-facing component)
```

### TRE responsibilities (the shared executor logic)

```
connect → harden session → run → mask output → return → teardown
```

Both tiers share this core; they differ in lifecycle and credential model.

- Retrieve a least-privilege credential (leased + renewed for the read pool; single-use for writes).
- Establish a hardened session: reads get `SET TRANSACTION READ ONLY`; writes get `lock_timeout`; both get `statement_timeout` and row caps via **cursor-based fetching** (`pg-cursor`).
- Reads `ROLLBACK` (read txn); writes `COMMIT` only the approved, validated SQL.
- Apply PII masking (per Cerbos `maskedColumns`) **before results leave**.
- Record the execution log (hash-chain entry).
- Tear down (write unit destroyed; pool worker returned to the pool).

### Execution strategy — two tiers, one executor

Reads and writes share the **same executor logic** — only the lifecycle and *where it runs* change.

**Read tier — warm pool.** Reads are the most frequent, lowest-risk traffic; paying a 1–3s container cold-start per read is wasteful. Instead, a pool of long-lived, isolated workers serves them. Per-query isolation comes from the read-only transaction + caps + a Vault lease renewed on a short cycle — still short-lived and least-privilege, just amortized.

**Write tier — ephemeral, approved writes only.** Writes are rare and already gated by minutes of approval latency, so they pay cold-start for maximum isolation: a fresh single-use environment with a single-use credential, destroyed after `COMMIT`. The write tier runs the dry-run (rollback) at simulation time and the commit at execution time.

| Phase | Read tier | Write tier | Node tooling |
|-------|-----------|------------|--------------|
| **1** | In-process worker | Same, single-use txn | `bullmq`, `worker_threads`, `pg`, `pg-cursor` |
| **2** | Pool of reused containers | Ephemeral container per write | `dockerode` |
| **3** | Hardened `Deployment`, autoscaled | One-shot k8s `Job` per write | `@kubernetes/client-node` (NetworkPolicy, PodSecurityContext, TTL cleanup) |

**Concurrency** is handled by Postgres MVCC + row locks + `lock_timeout` — overlapping writes serialize naturally; a blocked write fails fast and is logged. No custom concurrency control, no copy-and-merge.

### TRE network posture

Execution workers (both tiers) run on their **own network segment with no internet egress** — they can reach only Redis (jobs) and the target databases (via leased/JIT credentials). A compromised worker can't phone home, and the read-pool lease/short-TTL write credential can't be reused later.

---

## 15. Audit System (Hash-Chain)

Every action generates an immutable audit event: login, query generation, validation, execution, approval/rejection decisions, policy changes, and security incidents.

**Stored per event:** user, organization, environment, original prompt, generated SQL, final (rewritten) SQL, risk level, approval history, execution status, result metadata, timestamp, IP address.

**Tamper-evidence via hash chain:**

```
current_hash = SHA256(previous_hash + canonical_json(current_event))
```

The admin dashboard exposes a **"verify integrity"** action that recomputes the chain from the first entry and flags any row whose hash doesn't match. This is the tamper-evident audit trail **without an actual blockchain** — and it's demoable live: edit a row directly in the database, hit verify, watch it fail. Explaining *why* a hash chain is the right tool here (and blockchain is overkill) is a stronger signal than a half-working testnet integration.

Helpers live in **`packages/audit`**.

---

## 16. Policy Engine (Cerbos + org knobs)

Authorization is a **Cerbos** policy decision point, split into two layers (see §5 and §10):

- **Custom roles = data.** Admins define roles ("dev", "marketing", "analytics") with capability sets as `custom_roles` rows. No YAML, no redeploy. `api` flattens a user's role into principal attributes at request time.
- **One generic, per-product Cerbos policy.** Knows nothing about role names; asks attribute questions true for every org: is the action in the principal's capabilities; does the resource belong to the principal's org; is this a production write needing approval; which columns are masked.

The org also sets a few **tunable knobs** (stored as data, surfaced as Cerbos attributes), which is what "policy engine UI" manages:

| Policy type | Examples | Where enforced |
|-------------|----------|----------------|
| **Custom roles** | "dev" = CRUD; "marketing" = view; "analytics" = read+edit | `custom_roles` rows → principal attrs |
| **PII column policies** | Mask `email`, `phone`, national ID, `salary`, `credit_card` | Cerbos `maskedColumns` output → executor |
| **Environment policies** | dev allow all; staging warn; production block destructive | Cerbos condition on `environment` |
| **Time policies** | Production writes only 09:00–18:00 IST | Cerbos condition on request time |
| **Rate-limit policies** | Per-user query/min, per-org AI-calls/day, per-org max concurrent executions | `rate-limiter-flexible` + BullMQ |

A DENY rule (e.g. production write without approval) overrides any capability — the platform guarantee that justifies an external PDP over an in-code check. Supported environments per org: **Development**, **Staging**, **Production**, each with its own connected database and policy posture.

---

## 17. Identity, Authentication & Authorization

Three concerns, three tools. **Keycloak** = who you are; **PASETO** = the tokens carrying that around; **Cerbos** = what you're allowed to do.

### Identity — Keycloak (OIDC)

- Signup, login, password reset, MFA, sessions, and organizations are handled by Keycloak. SafeQuery stores **no passwords**.
- The browser authenticates against Keycloak; `api` validates the OIDC token against Keycloak's JWKS and provisions users/orgs via the admin REST client.
- Enterprise story: integrate with an existing IdP via OIDC rather than reinventing login.

### Session & service tokens — PASETO

- **User sessions — `v4.local`:** after OIDC validation `api` mints an encrypted token containing only `{ user_id, session_id }`; the browser holds this (not the Keycloak token); immediate server-side revocation; sidesteps JWT `alg`-confusion attacks.
- **Service-to-service — `v4.public`:** `api` signs (Ed25519); `ai-service`/`tre-dispatcher` verify with the public key, no shared secret; `kid` enables graceful rotation.
- Lives in **`packages/auth`** (alongside the Keycloak OIDC validation + admin-client wrapper).

### Authorization — Cerbos

- Every request resolves live org/custom-role/department, flattens to principal attributes, and calls Cerbos `checkResources`; the decision + outputs drive the validator and executor. Permissions are never baked into any token.

---

## 18. API Surface (tRPC + Scalar)

### tRPC for internal traffic

`web` ↔ `api` uses native **tRPC** for end-to-end type inference across the monorepo — trivial here, painful in most stacks, and a clear "I know my tools" signal. Service-to-service calls (`api` → `ai-service`, `api` → `tre-dispatcher`) can also use tRPC, sharing the router type across packages, authenticated via the PASETO public tokens as tRPC middleware/context.

### Scalar for the documented REST surface

tRPC procedures aren't naturally REST, but **`trpc-to-openapi`** attaches `meta: { openapi: { method, path } }` to procedures that already have Zod input/output schemas (which the AI structured-output and policy validation need anyway), generating a real **OpenAPI 3.1** document. That document is served through **`@scalar/express-api-reference`** at `/docs`.

**What gets documented:** policy-engine endpoints, org/user management, audit-log retrieval, approval-queue endpoints — the "platform API" a customer's own tooling would integrate against.

**What stays tRPC-only internal:** the chat/query-execution flow — exposing raw SQL execution as a documented public endpoint would undercut the security story.

---

## 19. Rate Limiting & Throttling

Rate limits are a **governance control** in SafeQuery's world, not just middleware. Three layers:

| Layer | Mechanism | Protects |
|-------|-----------|----------|
| **Edge** | Cloudflare rate-limiting rules, per-IP | Coarse anti-abuse before traffic reaches the app |
| **Application** | `rate-limiter-flexible` + Redis, in Express/tRPC middleware | Per-user (N chat queries/min) and per-org (N AI calls/day — the LLM cost-control story), configurable per org via the policy engine |
| **Queue** | BullMQ concurrency limiter on the `tre-dispatcher` queue | Caps concurrent executions per org so one tenant can't exhaust shared resources or hammer **the customer's own database** |

That third layer is worth calling out specifically: it's a rate limit that protects the *customer's* database, not just SafeQuery's. Configs live in **`packages/rate-limit`**, shared across `api` and `tre-dispatcher`.

---

## 20. Defense-in-Depth Security Model

Each link assumes the previous one failed:

| # | Layer | What it catches |
|---|-------|-----------------|
| 1 | **Authentication** (Keycloak OIDC + PASETO session) | Unauthenticated access; token-forgery classes |
| 2 | **Authorization** (Cerbos, live attribute resolution) | Wrong-role access; stale permissions |
| 3 | **Policy invariants** (Cerbos DENY rules) | Org/environment/approval/PII overrides |
| 4 | **Prompt-injection detection** | Manipulated prompts before generation |
| 5 | **Schema filtering** | The model referencing tables it can't see → less bad SQL generated at all |
| 6 | **SQL AST validation** | Bad statement types, forbidden tables/columns, multi-statements |
| 7 | **Row-filter injection** (from Cerbos outputs) | The model omitting permission filters (the #1 text-to-SQL hole) |
| 8 | **Risk engine** | Routing destructive/suspicious queries to approval or rejection |
| 9 | **TRE isolation** (two tiers) | Credential exposure; unbounded blast radius; data exfiltration |
| 10 | **Database roles + RLS** | Final backstop if everything upstream was bypassed |
| 11 | **Immutable audit logs** | Tampering; non-repudiation |
| 12 | **Observability** | Anomaly detection in aggregate |

**The strongest demo:** disable layer 6 (the validator) and show a malicious query still getting caught by layer 10 (database RLS + grants) — proving the layers are genuinely independent.

Platform-level additions: `helmet` on Express, Zod validation at every input boundary, Trivy container scanning + dependency auditing in CI.

---

## 21. Multi-Server Architecture

Five independently deployable Node services, plus two off-the-shelf infrastructure services (**Keycloak**, **Cerbos**). The split gives each piece its own reason to scale, fail, and deploy independently.

| Service | Stack | Responsibility |
|---------|-------|----------------|
| **`apps/web`** | Next.js + TS + Tailwind + shadcn/ui + TanStack Query + tRPC client | Chat interface, admin dashboard, role/policy editor, approval-queue UI |
| **`apps/api`** | Express + TS + Drizzle + tRPC server | OIDC validation + session minting, orgs/custom-roles CRUD, Cerbos calls, pipeline orchestration up to "enqueue execution job," Scalar `/docs` |
| **`apps/ai-service`** | TS + Vercel AI SDK | Text-to-SQL (structured), prompt-injection screen, risk scoring, dry-run simulation. Starts inside `api`; extracted when independent LLM scaling is needed |
| **`apps/tre-dispatcher`** | TS + BullMQ | Consumes the queue; **routes reads to the warm pool and approved writes to the ephemeral path** |
| **`apps/tre-executor`** | Minimal TS image | The execution logic only. Runs as warm-pool worker (reads) or one-shot unit (writes); the only component that touches customer databases |
| **Keycloak** | Off-the-shelf container | Identity provider (OIDC) |
| **Cerbos** | Off-the-shelf container | Policy decision point (sidecar to `api` in prod) |

**Communication:**

- `web` → `Keycloak`: OIDC login redirect
- `web` → `api`: tRPC (typed), PASETO `v4.local` session
- `api` → `Keycloak`: OIDC validation (JWKS) + admin REST
- `api` → `Cerbos`: `checkResources` (gRPC/HTTP)
- `api` → `ai-service`: tRPC / in-process (PASETO `v4.public`)
- `api` → `tre-dispatcher`: **BullMQ / Redis only — never a direct DB call**
- Results back to the chat UI: Redis pub/sub channel or a short-poll subscription endpoint

---

## 22. Monorepo Strategy (Turborepo)

**Yes, use Turborepo** — it's purely a build/dev-orchestration layer and doesn't change runtime architecture, so it's low-risk. With 5+ apps and genuinely shared packages, it gives one `turbo dev` to run everything locally, incremental builds/caching so CI rebuilds only what changed, and an `apps/* + packages/*` layout that mirrors the service architecture.

```
safequery/
├── apps/
│   ├── web/              # Next.js — chat, admin, role/policy UI
│   ├── api/              # Express — OIDC+session, orgs, custom-roles, Cerbos, orchestration, /docs
│   ├── ai-service/       # text-to-SQL, prompt firewall, risk, dry-run simulation
│   ├── tre-dispatcher/   # BullMQ worker; read-pool / ephemeral-write routing
│   └── tre-executor/     # minimal execution image (pool worker + one-shot)
│
├── packages/
│   ├── types/            # shared Zod schemas / TS types
│   ├── auth/             # PASETO local+public, Keycloak OIDC validation, admin-client wrapper
│   ├── policy-client/    # typed Cerbos checkResources wrapper
│   ├── cerbos-policies/  # generic per-product policy YAML (not per-org/role)
│   ├── sql-validator/    # node-sql-parser AST + Cerbos-decision application + row-filter injection
│   ├── audit/            # hash-chain helpers + verify-integrity
│   ├── db/               # Drizzle schema (incl. custom_roles), RLS policies, migrations (app DB)
│   ├── rate-limit/       # rate-limiter-flexible configs (shared: api + tre-dispatcher)
│   ├── ui/               # shared React components
│   └── config/           # shared eslint / tsconfig
│
├── infra/
│   ├── docker/           # incl. keycloak + cerbos compose services
│   ├── k8s/              # Helm charts / manifests
│   └── terraform/
│
└── turbo.json
```

---

## 23. Data Model

### App database (Drizzle ORM + Postgres)

Drizzle is chosen over Prisma because its SQL-like query builder fits a project whose pitch is "we understand SQL deeply," and because `drizzle-kit` migrations are **plain, reviewable SQL files**. Recent Drizzle supports `pgPolicy` (RLS) and `pgRole` directly in the schema file — so multi-tenant isolation (RLS keyed on `org_id`) and the reader/writer DB roles used in the TRE are **version-controlled, code-reviewed schema**, not console-clicked config.

Core tables (app DB, all tenant-scoped with RLS on `org_id` where applicable):

| Table | Purpose |
|-------|---------|
| `organizations` | Tenants (mirror Keycloak organizations) |
| `users` | Identity mirror keyed to the Keycloak subject; **no local password** (Keycloak owns auth) |
| `organization_members` | User↔org with `custom_role_id` + department |
| `custom_roles` | **Admin-defined roles as data:** `org_id`, `name`, `capabilities[]`, `table_scope[]`, `column_restrictions` jsonb, `row_filter_template`, `environments[]` |
| `invitations` | Pending member invites (delegated to Keycloak where possible) |
| `environments` | dev / staging / production per org |
| `database_connections` | Non-sensitive config + opaque credential reference |
| `schema_snapshots` | Discovered metadata fed to the AI |
| `policies` | Org-tunable knobs (PII columns, time windows, rate limits) read into Cerbos/risk attrs |
| `query_logs` | Generated + final SQL, status, risk, result summary |
| `approval_requests` | Requester, SQL, dry-run affected rows, reviewer, status |
| `audit_logs` | Hash-chained immutable events |

> Two notes: (1) the **TRE executor's connections to target customer databases stay raw `pg` + `pg-cursor`** — dynamic, unowned schemas, so Drizzle is used only for the app DB. (2) **Auth is split:** Keycloak owns credentials/sessions/MFA; `users` is a local mirror keyed on the Keycloak subject; `custom_roles` + `organization_members` are flattened into Cerbos principal attributes per request.

### Entity relationships

```
organizations 1──* organization_members *──1 users
organizations 1──* custom_roles 1──* organization_members
organizations 1──* environments
organizations 1──* database_connections 1──* schema_snapshots
organizations 1──* policies
users 1──* query_logs 1──0..1 approval_requests
query_logs 1──* audit_logs
```

---

## 24. Cloud & Deployment Strategy

### Local development

Docker Compose runs: Postgres (app DB), two or three Postgres instances seeded as **dev/staging/production customer databases** (this is what makes environment-policy demos real), Redis, Vault in dev mode, **Keycloak**, and **Cerbos** (policies mounted from `packages/cerbos-policies`). `turbo dev` runs all Node apps against them.

### Deployed

| Component | Target | Notes |
|-----------|--------|-------|
| `web` | **Vercel** | Next.js frontend |
| `api`, `ai-service`, `tre-dispatcher`, `tre-executor` (read `Deployment` + write `Job`) | **single-node k3s on a VPS** (Hetzner / DigitalOcean) | Affordable; manifests/Helm charts generalize to EKS/GKE — state this explicitly |
| **Keycloak** | **in-cluster** (or managed) | Identity provider (OIDC) |
| **Cerbos** | **sidecar to `api`** | Policy decision point; low-latency local calls |
| App database | **Managed Postgres** (Neon / Supabase) | Separate from customer demo DBs |
| Customer demo databases | **in-cluster StatefulSets** | Fully controlled for the environment-policy demo |
| Redis | **Managed** (Upstash) | Queue + rate-limit backend |
| Vault | **in-cluster** | Database secrets engine pointed at demo databases |
| Edge | **Cloudflare** | DNS, edge rate limiting, basic WAF, in front of both Vercel and cluster ingress |

### CI/CD — GitHub Actions

```
push → turbo lint + test (only changed apps, thanks to caching)
     → Docker build
     → Trivy security scan
     → push images
     → deploy via kubectl / Helm
```

### IaC — Terraform (later phase)

Provisions the VPS, DNS records, and firewall rules. Even a modest config covering those three is a legitimate IaC story.

---

## 25. Observability

Treat as a later phase (it's worthless before the core pipeline is solid), but it's what makes the demo feel like a product:

- **OpenTelemetry** — tracing across all services.
- **Prometheus + Grafana** — panels for query volume by risk level, approval-queue latency, worker error rate, execution duration, TRE health, queue length, LLM usage, error rates.
- **Loki** — log aggregation.
- **Sentry** — error tracking.
- **Pino** — structured JSON logging with credential redaction.

---

## 26. Technology Stack (Final)

**Frontend:** Next.js · TypeScript · Tailwind · shadcn/ui · TanStack Query · tRPC

**Backend:** Express · TypeScript · Drizzle ORM · PostgreSQL · Zod

**Identity & authz:** Keycloak (OIDC) · Cerbos (policy decision point) · PASETO (`v4.local` sessions + `v4.public` service-to-service)

**AI:** Vercel AI SDK · structured outputs (Zod) · provider pattern · OpenAI-compatible APIs

**TRE:** BullMQ · Redis · warm read pool + ephemeral write executor · worker threads → Docker containers (`dockerode`) → Kubernetes (`@kubernetes/client-node`) · `pg` + `pg-cursor` · dry-run-then-commit

**Security:** Keycloak · Cerbos · Postgres RLS · prompt firewall · AST validation (`node-sql-parser`) · risk engine · rate limiting (`rate-limiter-flexible`) · immutable hash-chain audit logs · AES-256-GCM → Vault

**Infrastructure:** Docker · Docker Compose · Kubernetes (k3s) · Cloudflare · Terraform · GitHub Actions

**Observability:** OpenTelemetry · Prometheus · Grafana · Loki · Sentry · Pino

**Documentation:** Scalar (`/docs`) · architecture diagrams · threat model · ADRs

**Monorepo:** Turborepo

---

## 27. Phased Build Plan (0 → 100)

### Phase 0 — Foundation

- Turborepo skeleton; `web` (Next.js) + `api` (Express + TS) scaffolded.
- `packages/auth` — Keycloak OIDC validation + PASETO `v4.local`/`v4.public` + admin-client wrapper; built first, nearly everything depends on it.
- **Keycloak** realm + Organizations + OIDC client configured.
- `packages/db` — Drizzle schema for orgs / users (Keycloak mirror) / `custom_roles` / `organization_members` with **live attribute lookups** and RLS policies as code.
- **Cerbos** running in compose with `packages/cerbos-policies` (generic `db_table` policy + derived roles) and `packages/policy-client`.
- One seeded "customer" Postgres.
- tRPC + Scalar `/docs` dual surface wired up.
- Docker Compose for local dev (incl. Keycloak + Cerbos).

### Phase 1 — The Differentiator (build this fully before anything else)

- `ai-service` module: schema-filtered prompts, structured SQL via Vercel AI SDK + Zod, prompt-injection screen.
- `packages/sql-validator`: AST checks + **Cerbos-decision application** + **row-filter injection** from Cerbos outputs, adversarial unit tests.
- Risk engine (SAFE / WARNING / CRITICAL / SECURITY_INCIDENT).
- Simulation: EXPLAIN for reads; **transactional dry-run (RETURNING + ROLLBACK)** for writes.
- **Phase-1 TRE:** BullMQ + `worker_threads`, read path (read-only + caps) and write path (dry-run / commit, single-use), `pg-cursor`, PII masking; concurrency via `lock_timeout`.
- `packages/audit`: hash-chain log + verify-integrity endpoint.
- **Goal: fully demoable against one database.**

### Phase 2 — Governance

- Multi-tenancy + invitations (Keycloak).
- **Custom-roles CRUD** + role/policy editor UI (PII columns, environment + time policies, rate-limit knobs).
- Approval workflow with reviewer re-authentication, showing exact dry-run affected rows.
- Multiple DB connections per org with envelope-encrypted credentials.

### Phase 3 — Real Isolation

- Extract `tre-dispatcher` / `tre-executor` as separate apps; split into **warm read pool** + **ephemeral write executor**.
- `dockerode`-launched containers; strict container networking; masking at the executor boundary.
- Short-lived credentials: app-issued temporary roles → **Vault dynamic secrets** (renewed leases for the pool, single-use for writes).

### Phase 4 — Cloud-Native

- Read pool as a hardened **k8s `Deployment`** (autoscaled); writes as one-shot **k8s `Job`s** (`@kubernetes/client-node`) with NetworkPolicies + hardened pod security.
- Deploy: k3s on a VPS, Next.js on Vercel, managed Postgres/Redis, in-cluster Vault + Keycloak + demo databases; Cerbos as `api` sidecar.
- GitHub Actions CI/CD with Trivy; Cloudflare in front.

### Phase 5 — Observability & Polish

- OpenTelemetry across services; Prometheus / Grafana / Loki; Sentry.
- Terraform for VPS / DNS / firewall.
- Recorded demo walking a SAFE, a WARNING, and a CRITICAL query (with dry-run + approval) through the full path.

---

## 28. Threat Model

| Threat | Mitigation |
|--------|------------|
| **Prompt injection** (manipulating the LLM via the prompt or via stored data) | Pre-generation injection screen; SECURITY_INCIDENT classification → hard reject; the model only sees filtered schema and never executes its own output |
| **SQL injection / malicious generated SQL** | AST validation; Cerbos table/column/action allowlist; multi-statement rejection; row-filter injected by validator |
| **Privilege escalation** | Live attribute resolution + Cerbos DENY invariants; DB-level grants + RLS as backstop |
| **Credential theft** | Core API never holds usable creds; envelope encryption → Vault leases (renewed for pool, single-use for writes); redacted logging |
| **Data exfiltration** | TRE network isolation (no egress); PII masking before results leave; row caps via cursor |
| **Destructive operations** | Read tier is read-only; writes need approval + exact dry-run; Cerbos denies production writes without approval |
| **Concurrent write conflicts** | Postgres MVCC + row locks + `lock_timeout`; conflicts logged, never silently merged |
| **Cross-tenant access** | Cerbos org-scope rule + Postgres RLS keyed on `org_id` across all tenant-scoped tables |
| **Audit tampering** | SHA-256 hash chain; verify-integrity recomputation |
| **Resource exhaustion / noisy neighbor** | Three-layer rate limiting incl. per-org execution concurrency cap |
| **Token forgery** | PASETO (no `alg: none`); OIDC validation against Keycloak JWKS; encrypted local tokens; signed public tokens for services |

---

## 29. Demo Script

A three-act walkthrough that exercises every layer:

1. **SAFE path** — Analyst asks "show top 20 customers by revenue." Watch: schema filtered → SQL generated + explained → validator passes → risk = SAFE → TRE executes read-only → masked results returned → audit entry appended.
2. **WARNING path** — Analyst asks for a large unbounded scan of a table containing PII. Watch: risk = WARNING → user acknowledgment prompt → execution with PII columns masked in the output.
3. **CRITICAL path** — Analyst asks to "delete inactive customers" in production. Watch: risk = CRITICAL → transactional dry-run shows the exact rows that would be deleted (run with `RETURNING` then rolled back, nothing committed) → routed to Reviewer → reviewer re-authenticates → approves → ephemeral write executor commits the same SQL → approver recorded in audit.
4. **Security incident** — Submit a prompt-injection attempt. Watch: SECURITY_INCIDENT → hard reject, no approval path, logged as a security event.
5. **Audit integrity** — Open the audit viewer, hit "verify integrity" (passes). Manually edit a row in the database, verify again (fails) — proving tamper-evidence.
6. **Defense-in-depth** — Disable the validator, replay the malicious query, show DB-level RLS + grants still block it.

---

## 30. Future Research (Explicitly Out of Scope)

Named in the README as researched extensions — ambition signaling without the attestation-debugging cost:

- **Firecracker microVMs** / **gVisor** — per-query microVM/sandbox isolation.
- **AWS Nitro Enclaves** / **Intel SGX** — hardware-level, memory-isolated execution with attestation.
- Additional dialects: Snowflake, BigQuery, SQL Server (via the adapter interface).

These are intentionally excluded from the MVP. A one-paragraph "here's how I'd extend the TRE with Nitro Enclaves for true memory-level isolation" demonstrates depth; building it would cost months and be unverifiable in a portfolio review.

---

## 31. Success Criteria

SafeQuery succeeds if:

- AI-generated SQL is **never executed blindly** — every query is validated, risk-scored, and (when risky) approved.
- Organizations can **safely adopt AI** for database operations without distributing credentials or losing oversight.
- Security and governance remain **enforceable and configurable** per org/environment.
- **Every action is auditable** and tamper-evident.
- The system demonstrates **production-grade, cloud-native engineering** across full-stack, AI, security, distributed systems, cloud/DevOps, and observability.

> **Core philosophy, restated:**
> Never trust AI output. Validate everything. Execute nothing without controls. Assume compromise and design for containment.
>
> SafeQuery isn't built to showcase AI integrations — it's built to demonstrate the ability to design and implement secure, scalable, observable, cloud-native systems that enterprises can trust. The goal is simple: **enable organizations to leverage AI without sacrificing control.**
