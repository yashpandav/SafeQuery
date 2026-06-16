# SafeQuery — Product Requirements Document (PRD)

**Document type:** Product Requirements
**Product:** SafeQuery — Enterprise AI Database Governance Platform
**Status:** Draft v1.0
**Owner:** Yash Pandav

---

## 1. Overview

SafeQuery is a control plane that sits between an LLM and a real database. It lets users ask questions in natural language, generates SQL, proves that SQL is safe (or routes it through human approval), executes it under tightly constrained conditions, and records every action in a tamper-evident audit trail.

This PRD defines **what** SafeQuery does and **why**, from a product perspective. Technical implementation lives in the Technical Architecture Document; security controls live in the Security & Access Document.

---

## 2. Problem Statement

Employees increasingly paste AI-generated SQL directly into production databases. This workflow has no validation, no permission enforcement, no approval step, and no audit trail, and it forces database credentials to be distributed widely. The result is a high risk of accidental data loss, data leakage, and compliance violations.

Existing AI-SQL tools optimize for convenience. No widely available tool treats the AI→database boundary as a governance problem first.

---

## 3. Goals & Non-Goals

### Goals

- Let non-experts query databases in natural language without writing SQL.
- Guarantee that no AI-generated SQL is ever executed without validation and policy checks.
- Enforce per-user, per-role, per-environment permissions at query time.
- Route destructive or elevated operations through human approval.
- Mask sensitive data before it leaves the execution boundary.
- Produce a complete, tamper-evident audit trail of every action.
- Keep database credentials confined to an isolated execution layer.

### Non-Goals

- SafeQuery is **not** a BI/dashboarding tool (no chart builder, no scheduled reports in v1).
- SafeQuery is **not** a general database client / SQL IDE.
- SafeQuery is **not** an AI chatbot for general conversation.
- SafeQuery does **not** train or fine-tune models on customer data.

---

## 4. Target Users & Personas

| Persona | Role | Primary need | Key actions |
|---------|------|--------------|-------------|
| **Olivia (Owner)** | Founder / IT lead | Stand up a governed workspace | Create org, configure billing, set org-wide governance |
| **Amir (Admin)** | Platform admin | Control access & connections | Manage members, connect databases, define policies, configure environments |
| **Ravi (Reviewer)** | Data lead / manager | Safely approve risky operations | Review risk + simulation reports, approve/reject elevated requests |
| **Ana (Analyst)** | Business analyst | Get answers without SQL skills | Ask questions, acknowledge warnings, run approved queries |
| **Vik (Viewer)** | Stakeholder | Visibility without write access | View results and activity |

---

## 5. User Stories

### Onboarding & access

- As an **Owner**, I can create an organization workspace so my team has an isolated environment.
- As an **Owner**, I can invite team members by email and assign them a role.
- As an **Admin**, I can configure development, staging, and production environments.
- As a **new member**, my account starts in a pending state until an admin assigns my role, so access is never granted by default.
- As an **Admin**, I can create custom roles (e.g. "dev" with full CRUD, "marketing" with view-only, "analytics" with read+edit) with any name and capability set, without anyone touching code or redeploying.
- As an **Admin**, I can change or revoke a member's role and have it take effect immediately, not at token expiry.

### Database connectivity

- As an **Admin**, I can connect a PostgreSQL database by entering its connection details.
- As an **Admin**, I can see SafeQuery test connectivity and discover the schema before saving a connection.
- As an **Admin**, I never have to expose the database to the public internet beyond what my own network allows; SafeQuery stores no plaintext credentials.

### Asking questions

- As an **Analyst**, I can type a question in plain English and receive generated SQL with an explanation and a risk level before anything runs.
- As an **Analyst**, I can only query the tables and columns my role permits.
- As an **Analyst**, when a query is flagged WARNING, I'm asked to acknowledge before it runs.
- As an **Analyst**, when a query is CRITICAL, it's sent for approval instead of executing.

### Approval

- As a **Reviewer**, I receive a queue of pending requests showing the prompt, the SQL, the risk assessment, and an exact preview of the rows a write would change (produced by a transactional dry-run, nothing committed).
- As a **Reviewer**, I must re-authenticate before approving an elevated request.
- As a **Reviewer**, my decision and identity are recorded in the audit trail.

### Results & safety

- As an **Analyst**, I receive results with sensitive columns masked according to policy.
- As an **Analyst**, I can export results as CSV/JSON/Excel.
- As any **user**, every query I run is logged with full metadata.

### Governance & audit

- As an **Admin**, I can define query restrictions, PII column policies, environment policies, time policies, and rate limits.
- As an **Admin**, I can view the audit log and verify its integrity at any time.
- As an **Admin**, I can see when a security incident (e.g. prompt injection attempt) was blocked.

---

## 6. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Users authenticate via Keycloak (OIDC); SafeQuery stores no passwords; sessions use encrypted PASETO tokens | Must |
| FR-2 | Permissions are resolved live per request via Cerbos; never cached in any token | Must |
| FR-3 | Org admins can invite and remove members | Must |
| FR-4 | Built-in platform roles: Owner, Admin, Reviewer, Analyst, Viewer | Must |
| FR-4b | Admins can create custom roles with arbitrary names + capability sets as data (no redeploy) and assign them to members | Must |
| FR-5 | Admins can connect PostgreSQL databases with connectivity test + schema discovery | Must |
| FR-6 | Credentials are encrypted at rest; never returned to the client or sent to the LLM | Must |
| FR-7 | Natural-language prompt produces structured SQL + explanation + risk level | Must |
| FR-8 | LLM receives only the schema filtered to the user's permissions | Must |
| FR-9 | Prompt-injection attempts are detected and blocked before generation | Must |
| FR-10 | All generated SQL is parsed to an AST; authorization decided by Cerbos | Must |
| FR-11 | Row-level filters are injected by the system (from Cerbos outputs), not trusted from the model | Must |
| FR-12 | Queries are classified SAFE / WARNING / CRITICAL / SECURITY_INCIDENT | Must |
| FR-13 | SAFE executes automatically; WARNING requires acknowledgment; CRITICAL requires approval; SECURITY_INCIDENT is hard-rejected | Must |
| FR-14 | Destructive/elevated writes show an exact dry-run (transactional rollback) of affected rows before approval | Must |
| FR-15 | Reviewers approve/reject with re-authentication; decisions are audited | Must |
| FR-16 | All SQL executes only inside the isolated TRE; the core API never touches a customer DB | Must |
| FR-17 | Reads run on a warm isolated pool (read-only, row-capped); approved writes run in fresh ephemeral environments and commit transactionally | Must |
| FR-18 | Results are masked per PII policy before leaving the execution boundary | Must |
| FR-19 | Every action is recorded in a SHA-256 hash-chain audit log | Must |
| FR-20 | Admins can run an integrity check on the audit log | Must |
| FR-21 | Policies configurable per org: PII, environment, time, rate limits; custom roles as data | Must |
| FR-22 | Multi-tenant isolation: no org can access another org's resources | Must |
| FR-23 | Concurrent operations handled safely via DB MVCC/locks; conflicts logged | Must |
| FR-24 | Rate limiting at edge, application (per-user/per-org), and queue (per-org concurrency) | Should |
| FR-25 | Results exportable as CSV / JSON / Excel | Should |
| FR-26 | Documented REST API surface for platform endpoints | Should |
| FR-27 | MySQL/PlanetScale support | Could (Phase 2) |
| FR-28 | Snowflake/BigQuery support | Could (Phase 3) |
| FR-29 | Observability dashboards (query volume, approvals, errors) | Could |

---

## 7. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Security** | Defense in depth; no plaintext credentials; least privilege; zero-trust service-to-service auth |
| **Auditability** | Every state-changing action produces an immutable, verifiable audit event |
| **Performance** | SAFE query round-trip (prompt → result) target < 5s p95 excluding LLM latency |
| **Scalability** | Execution layer scales horizontally; one tenant cannot exhaust shared resources |
| **Availability** | Stateless services horizontally scalable; queue absorbs execution bursts |
| **Isolation** | Multi-tenant data isolation enforced at the database layer (RLS), not just app code |
| **Observability** | Tracing, metrics, structured logs, error tracking across all services |
| **Maintainability** | Monorepo with shared, independently testable packages; IaC for environment reproducibility |

---

## 8. Query Risk Model (Product View)

| Level | What it means to the user | What happens |
|-------|---------------------------|--------------|
| **SAFE** | Routine read within limits | Runs immediately, results returned |
| **WARNING** | Larger or more sensitive than usual | User acknowledges, then it runs |
| **CRITICAL** | Could change or remove data | Sent to a Reviewer with an impact simulation |
| **SECURITY_INCIDENT** | Looks like an attack | Blocked outright; logged; no way to approve it |

---

## 9. Success Metrics

| Metric | Target |
|--------|--------|
| Queries executed without manual SQL | 100% of analyst queries go through NL |
| Blind executions (SQL run without validation) | 0 |
| Destructive ops in production without approval | 0 |
| Audit coverage | 100% of state-changing actions logged |
| Audit integrity verification | Passes on demand; tampering detectable |
| Cross-tenant data access incidents | 0 |
| Demo: SAFE / WARNING / CRITICAL / incident paths | All four demonstrable end to end |

---

## 10. Release Plan (Product Milestones)

| Milestone | Outcome the user can see |
|-----------|--------------------------|
| **M1 — Core pipeline** | An analyst asks a question against one database and gets a validated, risk-scored, audited result |
| **M2 — Governance** | Admins manage members, policies, and approvals across multiple databases and environments |
| **M3 — Isolated execution** | Executions run in isolated, ephemeral environments with short-lived credentials |
| **M4 — Cloud-native** | The platform runs as independent services in the cloud with CI/CD |
| **M5 — Operations** | Dashboards, integrity tooling, and a polished demo |

---

## 11. Assumptions & Constraints

- Target databases are PostgreSQL in v1 (covers Supabase, Neon, RDS, self-hosted).
- Connected databases are reachable from the execution layer's network.
- An external LLM provider (OpenAI-compatible) is available; provider is swappable.
- **Identity is delegated to Keycloak (OIDC); authorization decisions to Cerbos.** SafeQuery hand-rolls neither login nor a rules engine.
- **Custom roles are application data, not policy:** any number of differently-named roles per org incur no code or deployment change.
- The product is built and operated by a single engineer for portfolio purposes; "customer databases" are seeded instances that exercise the identical code path.

---

## 12. Open Questions

- Should the WARNING acknowledgment be remembered per query pattern, or always prompted?
- Should Reviewers be able to edit SQL before approving, or only approve/reject as-submitted?
- How long should approved-query authorizations remain valid before requiring re-submission?
