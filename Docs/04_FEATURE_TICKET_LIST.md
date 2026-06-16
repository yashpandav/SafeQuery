# SafeQuery — Feature Ticket List (Backlog)

**Document type:** Engineering Backlog
**Product:** SafeQuery — Enterprise AI Database Governance Platform
**Status:** Draft v1.0
**Convention:** Tickets are grouped by epic and tagged with the build phase (P0–P5). Each ticket has acceptance criteria. `M` = Must, `S` = Should, `C` = Could.

---

## Epic 0 — Foundation & Tooling (P0)

### SQ-001 — Initialize Turborepo monorepo `[M][P0]`
- **Description:** Scaffold Turborepo with `apps/` and `packages/` workspaces, shared `config` (eslint/tsconfig), and `turbo.json` pipelines.
- **Acceptance:** `turbo dev`, `turbo lint`, `turbo build` run across workspaces; CI caching verified; folder layout matches the architecture doc.

### SQ-002 — Scaffold `web` (Next.js) app `[M][P0]`
- **Acceptance:** Next.js + TS + Tailwind + shadcn/ui boots; tRPC client + TanStack Query wired; placeholder routes for chat, admin, policies, approvals.

### SQ-003 — Scaffold `api` (Express + tRPC) app `[M][P0]`
- **Acceptance:** Express server with tRPC router mounted; health endpoint; Zod-validated example procedure consumed type-safely by `web`.

### SQ-004 — `packages/db`: Drizzle schema + migrations `[M][P0]`
- **Description:** Define core tables; `drizzle-kit` migrations as SQL.
- **Acceptance:** Migrations apply cleanly; tables created: organizations, users (Keycloak-subject mirror), organization_members, **custom_roles**, invitations, environments, database_connections, schema_snapshots, policies, query_logs, approval_requests, audit_logs.

### SQ-005 — `packages/db`: RLS policies + DB roles as code `[M][P0]`
- **Acceptance:** `pgPolicy` on tenant-scoped tables keyed on `org_id`; reader/writer `pgRole` defined; a cross-tenant read returns zero rows under RLS in tests.

### SQ-006 — `packages/auth`: Keycloak OIDC + PASETO module `[M][P0]`
- **Description:** Keycloak OIDC token validation (JWKS), session minting as PASETO `v4.local`, service-to-service PASETO `v4.public` with `kid`, and an admin-client wrapper for user/org provisioning.
- **Acceptance:** Valid Keycloak token → minted session; tampered token rejected; public sign/verify + `kid` rotation covered by tests.

### SQ-006b — Keycloak realm + Organizations config `[M][P0]`
- **Acceptance:** Realm with platform roles (Owner/Admin/Reviewer/Analyst/Viewer) and OIDC client configured; Keycloak Organizations map to SafeQuery orgs; `api` provisions a user+org on first login.

### SQ-006c — `packages/cerbos-policies` + `packages/policy-client` `[M][P0]`
- **Acceptance:** Cerbos runs in compose with a mounted `db_table` resource policy + derived roles; `policy-client` wraps `checkResources` with typed inputs; an allow and a deny case are unit-tested against the running PDP.

### SQ-007 — Local dev via Docker Compose `[M][P0]`
- **Acceptance:** `docker compose up` brings up app Postgres, 2–3 seeded customer Postgres (dev/staging/prod), Redis, Vault dev mode, **Keycloak**, **Cerbos**; seed scripts load sample schema + data.

### SQ-008 — `packages/types`: shared Zod schemas `[M][P0]`
- **Acceptance:** Shared types consumed by `web`, `api`, and `ai-service`; single source of truth verified by type errors on mismatch.

### SQ-009 — Scalar `/docs` from tRPC OpenAPI `[S][P0]`
- **Acceptance:** `trpc-to-openapi` generates OpenAPI 3.1 from annotated procedures; Scalar UI served at `/docs` listing platform endpoints.

---

## Epic 1 — Identity, Auth & Authorization (P0–P1)

### SQ-010 — Keycloak login + user/org provisioning `[M][P0]`
- **Acceptance:** OIDC login flow works end to end; first login provisions a local `users` mirror row + org membership; no password stored in SafeQuery.

### SQ-011 — PASETO session issuance after OIDC `[M][P0]`
- **Acceptance:** After Keycloak validation, `api` mints a `v4.local` session token (`{ user_id, session_id }`); server-side session record created; browser never holds the Keycloak token.

### SQ-012 — Live attribute resolution + Cerbos decision middleware `[M][P1]`
- **Acceptance:** Each authorized request resolves org/custom-role/department from DB, flattens to principal attributes, and calls Cerbos; a role change is reflected on the very next request (no token re-issue).

### SQ-013 — Session revocation `[M][P1]`
- **Acceptance:** Revoking a session invalidates the token immediately on the next request.

### SQ-014 — Platform-role + Cerbos-gated procedures `[M][P1]`
- **Acceptance:** Each tRPC procedure enforces platform roles and/or a Cerbos decision; unauthorized callers receive a typed forbidden error.

---

## Epic 2 — Organizations & Membership (P1–P2)

### SQ-015 — Create organization + assign Owner `[M][P1]`
- **Acceptance:** A user can create an org and is assigned Owner; org-scoped resources initialize.

### SQ-016 — Invite members (Keycloak) `[M][P2]`
- **Acceptance:** Owner/Admin can invite via Keycloak; accepting joins the org in a pending state.

### SQ-017 — Custom roles CRUD + assignment `[M][P2]`
- **Acceptance:** Owner/Admin can create/edit custom roles (name + capabilities + table scope + row-filter template + environments) as data; assign to members; revocation removes access immediately (ties to SQ-012); no redeploy for new roles.

### SQ-018 — Configure environments (dev/staging/prod) `[M][P2]`
- **Acceptance:** Admin creates environments per org; each can hold its own DB connection and policy posture.

---

## Epic 3 — Database Connectivity (P1–P2)

### SQ-019 — Add PostgreSQL connection `[M][P1]`
- **Acceptance:** Admin enters host/port/db/user/password/SSL; non-sensitive config stored plain.

### SQ-020 — Envelope-encrypt credentials (AES-256-GCM) `[M][P1]`
- **Acceptance:** Credentials stored as ciphertext + IV + auth tag; core API holds only a reference; master key not present on the API side.

### SQ-021 — Connectivity test `[M][P1]`
- **Acceptance:** "Test connection" reports success/failure without persisting on failure; no credential echoed back.

### SQ-022 — Schema discovery + snapshot `[M][P1]`
- **Acceptance:** `information_schema` queried; snapshot of tables/columns/types/relationships stored; snapshot (not live connection) used for AI context.

### SQ-023 — Multiple connections per org/environment `[S][P2]`
- **Acceptance:** Org can register several databases mapped to environments; correct one selected per query.

### SQ-024 — Connector adapter interface `[C][P2]`
- **Acceptance:** Driver + parser dialect behind an interface; adding MySQL requires only a new adapter, no pipeline rewrite.

---

## Epic 4 — AI Generation Pipeline (P1)

### SQ-025 — Scaffold `ai-service` `[M][P1]`
- **Acceptance:** Module callable from `api` via tRPC (PASETO public); provider pattern over OpenAI-compatible API.

### SQ-026 — Schema-filtered prompting `[M][P1]`
- **Acceptance:** Only the user's permitted tables/columns are described to the model; forbidden objects never appear in the prompt.

### SQ-027 — Structured SQL generation (Zod) `[M][P1]`
- **Acceptance:** `generateObject` returns `{ sql, explanation, riskHint }` validated against a shared Zod schema; malformed output rejected.

### SQ-028 — Prompt sanitization `[M][P1]`
- **Acceptance:** Prompts normalized; control/escape sequences stripped before processing.

### SQ-029 — Prompt-injection screen `[M][P1]`
- **Acceptance:** Heuristic + small-model pass; positives classified SECURITY_INCIDENT and blocked before generation; logged.

### SQ-030 — SQL explanation surfaced to user `[S][P1]`
- **Acceptance:** Plain-language explanation shown alongside generated SQL before any execution.

---

## Epic 5 — Validation Engine (P1)

### SQ-031 — `packages/sql-validator`: AST parsing `[M][P1]`
- **Acceptance:** `node-sql-parser` parses generated SQL (Postgres dialect); unparseable SQL rejected.

### SQ-032 — Cerbos-based authorization in validation `[M][P1]`
- **Acceptance:** Per (table, action) the validator calls Cerbos; DENY fails validation, ALLOW contributes to the allowlist; statement type validated; violations rejected with reason.

### SQ-033 — Forbidden-pattern detection `[M][P1]`
- **Acceptance:** Multi-statements, DDL, system-table access, and missing `LIMIT` detected; join complexity flagged.

### SQ-034 — Row-filter injection from Cerbos outputs `[M][P1]`
- **Acceptance:** Validator rewrites the AST `WHERE` using the `rowFilter` returned in Cerbos `outputs`; verified that omitting it in generated SQL still results in a filtered final query.

### SQ-035 — Adversarial validator + policy test suite `[M][P1]`
- **Acceptance:** Corpus of injection strings, stacked statements, and escalation attempts; all blocked; Cerbos policy unit tests (allow/deny/output) run in CI alongside validator tests.

---

## Epic 6 — Risk & Simulation (P1)

### SQ-036 — Risk engine classification `[M][P1]`
- **Acceptance:** Validated query classified SAFE / WARNING / CRITICAL / SECURITY_INCIDENT per policy-configurable rules.

### SQ-037 — WARNING acknowledgment flow `[M][P1]`
- **Acceptance:** WARNING returns to the user for explicit acknowledgment before enqueueing.

### SQ-038 — Read-only simulation + transactional write dry-run `[M][P1]`
- **Acceptance:** `EXPLAIN` for reads; for writes, `BEGIN … RETURNING * … ROLLBACK` returns the exact rows that would change with nothing committed; estimated/affected rows returned; production untouched.

---

## Epic 7 — TRE / Execution (P1–P4)

### SQ-039 — BullMQ execution queue with read/write routing `[M][P1]`
- **Acceptance:** `api` enqueues jobs tagged `{ readOnly }`; `tre-dispatcher` routes reads to the pool path and approved writes to the ephemeral path; `api` never opens a customer DB connection.

### SQ-040 — Phase-1 executor: read path + write dry-run/commit `[M][P1]`
- **Acceptance:** Read jobs run a read-only, row-capped, `pg-cursor` transaction and roll back; write jobs run the validated SQL with `RETURNING *` and `COMMIT` (single-use), with `lock_timeout`/`statement_timeout` set; both teardown cleanly.

### SQ-041 — PII masking at the boundary `[M][P1]`
- **Acceptance:** Columns from the Cerbos `maskedColumns` output are masked in results before they leave the executor.

### SQ-042 — Result delivery to UI `[M][P1]`
- **Acceptance:** Results returned via Redis pub/sub or short-poll; chat UI renders results, SQL used, and execution metadata.

### SQ-043 — Warm read pool `[M][P3]`
- **Acceptance:** Reads served by a pool of reused, isolated workers (k8s `Deployment`), autoscaled on queue depth; per-job read-only transaction + caps; no per-query cold start.

### SQ-044 — Ephemeral write executor + Vault credentials `[M][P3]`
- **Acceptance:** Each approved write runs in a fresh single-use environment with a single-use Vault-issued credential; read pool uses short-cycle renewed leases; environment destroyed after `COMMIT`.

### SQ-045 — Phase-3 execution on Kubernetes `[M][P4]`
- **Acceptance:** Read pool as a hardened `Deployment`; writes as one-shot k8s `Job`s; both with `NetworkPolicy`, `PodSecurityContext` (non-root, read-only FS, dropped caps), resource limits, TTL cleanup.

### SQ-046 — Result export `[S][P2]`
- **Acceptance:** Results exportable as CSV / JSON / Excel.

### SQ-046b — Concurrency conflict handling `[M][P1]`
- **Acceptance:** Overlapping writes serialize via Postgres row locks; a blocked write hitting `lock_timeout` fails fast and is recorded as an audit event rather than hanging.

---

## Epic 8 — Approval Workflow (P2)

### SQ-047 — Create approval request `[M][P2]`
- **Acceptance:** CRITICAL writes create an `approval_request` with prompt, SQL, risk, **exact dry-run affected rows**, requester; analyst sees pending status.

### SQ-048 — Reviewer queue UI `[M][P2]`
- **Acceptance:** Reviewers see pending requests with prompt, SQL, risk assessment, simulation, estimated impact.

### SQ-049 — Approve/reject with re-auth `[M][P2]`
- **Acceptance:** Approval requires reviewer re-authentication; decision recorded; approved query enqueued; rejected query never runs.

### SQ-050 — Approval audit linkage `[M][P2]`
- **Acceptance:** Resulting execution's audit entry includes the approver identity and decision reference.

---

## Epic 9 — Policy Engine (Cerbos + org knobs) (P2)

### SQ-051 — Generic Cerbos policy bundle `[M][P2]`
- **Acceptance:** One per-product `db_table` resource policy + derived roles encode invariants (org-scope, capability check, production-write-needs-approval, PII masking); proven to work unchanged across two different orgs with differently-named custom roles.

### SQ-052 — PII column policies `[M][P2]`
- **Acceptance:** Admin marks columns as PII; surfaced as a resource attribute so Cerbos returns them in `maskedColumns`; applied to results at the executor.

### SQ-053 — Environment policies `[M][P2]`
- **Acceptance:** dev = allow all; staging = warn on destructive; prod = block destructive — expressed as Cerbos conditions on the `environment` attribute.

### SQ-054 — Time-window policies `[S][P2]`
- **Acceptance:** Production writes allowed only within a configured window; enforced via a Cerbos condition; out-of-window attempts blocked/escalated.

### SQ-055 — Role & policy editor UI `[M][P2]`
- **Acceptance:** Admin can create/edit custom roles and org policy knobs (PII, env, time, rate); changes versioned and audited; no Cerbos YAML editing required for everyday role management.

---

## Epic 10 — Audit System (P1–P2)

### SQ-056 — `packages/audit`: hash-chain writer `[M][P1]`
- **Acceptance:** Each event appended with `hash = SHA256(previous_hash + canonical_json(event))`; covers login, generation, validation, execution, approval, policy change, security incident.

### SQ-057 — Verify-integrity endpoint `[M][P1]`
- **Acceptance:** Recomputes the chain from genesis; reports first mismatch; passes on untouched data and fails on a manually edited row.

### SQ-058 — Audit viewer UI `[M][P2]`
- **Acceptance:** Admins browse/filter audit events; verify-integrity button surfaces result visually.

---

## Epic 11 — Rate Limiting (P2–P4)

### SQ-059 — Application rate limiting `[S][P2]`
- **Acceptance:** `rate-limiter-flexible` + Redis enforce per-user and per-org limits; configurable via policy engine.

### SQ-060 — Queue concurrency limiting `[S][P3]`
- **Acceptance:** BullMQ caps concurrent executions per org; one tenant cannot starve others or overload a customer DB.

### SQ-061 — Edge rate limiting (Cloudflare) `[S][P4]`
- **Acceptance:** Per-IP edge rules active in front of Vercel and cluster ingress.

---

## Epic 12 — Cloud, CI/CD & IaC (P4–P5)

### SQ-062 — Dockerize all services `[M][P3]`
- **Acceptance:** Each app has a minimal multi-stage Dockerfile; `tre-executor` image contains only execution logic.

### SQ-063 — GitHub Actions CI `[M][P4]`
- **Acceptance:** `turbo lint + test` (changed apps only) → build → Trivy scan → push images; pipeline gates on scan failures.

### SQ-064 — k3s deployment + Helm `[M][P4]`
- **Acceptance:** `api`/`ai-service`/`tre-dispatcher` deploy to k3s via Helm; customer demo DBs as StatefulSets; in-cluster Vault; `web` on Vercel.

### SQ-065 — Cloudflare edge config `[S][P4]`
- **Acceptance:** DNS, TLS, WAF rules, and edge rate limits in front of both surfaces.

### SQ-066 — Terraform IaC `[C][P5]`
- **Acceptance:** Terraform provisions VPS, DNS records, and firewall rules reproducibly.

---

## Epic 13 — Observability (P5)

### SQ-067 — Structured logging (Pino) `[M][P1]`
- **Acceptance:** JSON logs across services with credential redaction paths; no secret ever appears in logs.

### SQ-068 — OpenTelemetry tracing `[S][P5]`
- **Acceptance:** Traces span web → api → ai-service → dispatcher → executor for a single query.

### SQ-069 — Prometheus + Grafana dashboards `[S][P5]`
- **Acceptance:** Panels for query volume by risk, approval-queue latency, worker error rate, execution duration, queue length, LLM usage.

### SQ-070 — Loki + Sentry `[C][P5]`
- **Acceptance:** Logs aggregated in Loki; errors captured in Sentry with service tags.

---

## Epic 14 — Documentation & Demo (P5)

### SQ-071 — README with threat model + demo script `[M][P5]`
- **Acceptance:** README leads with problem, threat model, and demo script; architecture diagrams included; ADRs linked.

### SQ-072 — Recorded end-to-end demo `[S][P5]`
- **Acceptance:** Walks SAFE, WARNING, CRITICAL, SECURITY_INCIDENT, audit-integrity, and defense-in-depth (validator disabled, RLS still blocks) scenarios.

---

## Phase Rollup

| Phase | Epics primarily covered | Outcome |
|-------|------------------------|---------|
| **P0** | 0, parts of 1 | Repo, auth module, DB schema + RLS, local stack |
| **P1** | 1, 3, 4, 5, 6, 7, 10 (core) | Full SAFE/WARNING/CRITICAL pipeline against one DB, audited — **the differentiator** |
| **P2** | 2, 8, 9, 10 (UI), 3 (multi-conn) | Multi-tenant governance, approvals, policies |
| **P3** | 7 (container + Vault), 11 (queue) | Real isolation, dynamic credentials |
| **P4** | 7 (k8s), 12, 11 (edge) | Cloud-native multi-service deployment + CI/CD |
| **P5** | 12 (IaC), 13, 14 | Observability, IaC, docs, demo |
