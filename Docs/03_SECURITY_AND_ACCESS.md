# SafeQuery — Security & Access Document

**Document type:** Security & Access Control
**Product:** SafeQuery — Enterprise AI Database Governance Platform
**Status:** Draft v1.0
**Companion docs:** PRD, Technical Architecture Document, Feature Ticket List

---

## 1. Security Philosophy

SafeQuery is a security product, so its own posture must model what it sells:

1. **Never trust AI output.** Generated SQL is untrusted input, always validated.
2. **Execute nothing without controls.** Policy decides what runs; risky operations need human approval.
3. **Assume compromise.** Every layer is designed assuming the previous one failed.
4. **Reduce blast radius.** Isolated execution, short-lived credentials, least privilege everywhere.

---

## 2. Identity & Authentication

Identity, session security, and authorization are three separate concerns handled by three tools: **Keycloak** (identity), **PASETO** (tokens), **Cerbos** (authorization).

### 2.1 User authentication — Keycloak

- Signup, login, password reset, and MFA are handled by **Keycloak** via OIDC. SafeQuery stores **no passwords** (Keycloak owns credentials; it uses its own strong hashing internally).
- The browser authenticates against Keycloak; `api` validates the resulting OIDC token against Keycloak's **JWKS** endpoint.
- Keycloak **Organizations** map to SafeQuery orgs; coarse role/org membership comes from Keycloak claims. User/org provisioning uses the Keycloak admin REST client.
- Enterprise posture: SafeQuery integrates with an existing IdP (Keycloak/Okta/Entra via OIDC) instead of reinventing login.

### 2.2 Session tokens — PASETO `v4.local`

- After OIDC validation, `api` mints a **PASETO `v4.local`** session token (encrypted, XChaCha20-Poly1305) containing only `{ user_id, session_id }`. The browser holds this, not the Keycloak token.
- Opaque to the browser, decryptable only by `api`; eliminates the JWT `alg: none` / algorithm-confusion class.
- Session records stored server-side for immediate revocation.

### 2.3 Service-to-service authentication — PASETO `v4.public`

- **PASETO `v4.public`** (Ed25519). `api` signs; `ai-service` and `tre-dispatcher` verify with the public key. No shared secrets.
- **Key rotation:** rotate keypair, distribute public key via config; `kid` in the footer allows overlap during rotation.

### 2.4 Re-authentication

- Reviewers must re-authenticate (fresh Keycloak credential check) before approving an elevated/CRITICAL request.

---

## 3. Authorization (Cerbos + custom roles as data)

### 3.1 Principle

**Permissions are never stored in any token.** Every request resolves the caller's current org membership, custom role, and department via a live database lookup, flattens that into principal attributes, and asks **Cerbos** (the policy decision point) for an allow/deny decision plus outputs. This guarantees immediate revocation and a single source of truth.

### 3.2 Two-layer role model

- **Layer 1 — custom roles as data.** Org admins create roles with arbitrary names and capability sets ("dev" = CRUD on a table group; "marketing" = view-only; "analytics" = read+edit) as rows in `custom_roles`. Fully managed through the admin UI — no YAML, no redeploy. A new org with new roles is just new rows.
- **Layer 2 — one generic Cerbos policy.** Cerbos holds a single, **per-product** policy bundle that knows nothing about role names. At request time `api` resolves a user's custom role into flat attributes (`capabilities`, `tableScope`, `rowFilterTemplate`, `orgId`, `department`, `environment`, `approvalStatus`) and the policy asks attribute questions that are true for every org forever: is the action in the principal's capabilities; does the resource belong to the principal's org; is this a production write needing approval; which columns are masked.

### 3.3 Invariants Cerbos enforces (cannot be weakened by role naming)

- Cross-org access is impossible regardless of any capability.
- Production `update`/`delete` is denied unless `approvalStatus == "approved"`, regardless of capabilities.
- PII columns are masked regardless of `select` access.
- These are `DENY` rules that override capabilities — the reason an external PDP is justified over an in-code capability check.

### 3.4 Built-in platform roles

Keycloak still carries coarse platform roles for SafeQuery's own surfaces; capabilities below are enforced via Cerbos + app checks:

| Capability | Owner | Admin | Reviewer | Analyst | Viewer |
|------------|:-----:|:-----:|:--------:|:-------:|:------:|
| Manage billing / org settings | ✅ | — | — | — | — |
| Invite / remove members | ✅ | ✅ | — | — | — |
| Create/edit custom roles & assign them | ✅ | ✅ | — | — | — |
| Connect / manage databases | ✅ | ✅ | — | — | — |
| Define policies (PII, env, time, rate) | ✅ | ✅ | — | — | — |
| Configure environments | ✅ | ✅ | — | — | — |
| Approve / reject requests | ✅ | ✅ | ✅ | — | — |
| Submit NL queries | ✅ | ✅ | ✅ | ✅ | — |
| View query results | ✅ | ✅ | ✅ | ✅ | ✅ |
| View audit log | ✅ | ✅ | — | — | — |
| Verify audit integrity | ✅ | ✅ | — | — | — |

### 3.5 Query-level permissions

The user's custom role defines, per connected database: allowed tables/columns, allowed actions, an optional row-filter template, and row caps. Enforced at three points: schema filtering (what the AI sees), validator + Cerbos decision (allowlist + row-filter injection), and database-level grants + RLS.

---

## 4. Multi-Tenant Isolation

- Every tenant-scoped table carries `org_id`.
- **Postgres RLS policies** (defined as code via Drizzle `pgPolicy`) restrict every row to its owning org.
- The application sets the org context per request/connection; RLS enforces it even if application logic is bypassed.
- Protected resources: users, policies, audit logs, database connections, query history, approval workflows.
- **Result:** no tenant can read or affect another tenant's data, enforced at the database layer.

---

## 5. Secret Management

### 5.1 Connection credentials

- Split storage: non-sensitive config (host, port, db name, SSL mode, type) in plain columns; credentials protected.
- **Phase 1 — envelope encryption:** AES-256-GCM (Node `crypto`); data key encrypted by a master key held only on the execution side. Store ciphertext + IV + auth tag; core API holds only an opaque reference.
- **Phase 3 — Vault dynamic secrets:** Vault's database secrets engine mints a fresh, short-TTL Postgres role per execution — zero standing privileges.

### 5.2 Handling rules

- The **core API never holds a usable database credential** — only a reference.
- Credentials are **never** returned to the client, logged, or sent to the LLM.
- **Pino redaction paths** prevent secrets from reaching log output.
- Application signing/encryption keys (PASETO, envelope master key) are stored in environment/secret stores, never in source.

---

## 6. The AI Boundary

| The LLM receives | The LLM never receives |
|------------------|------------------------|
| Schema filtered to the user's permissions | Database credentials |
| Table/column descriptions | Full database visibility |
| Organizational policy context | Org secrets |

- **Prompt-injection screen** runs before generation; positives are classified `SECURITY_INCIDENT` and blocked.
- **Stored-data injection** (malicious text in query results manipulating a follow-up) is mitigated because the model never executes its own output and every query is re-validated.
- Generated SQL is treated as untrusted regardless of model confidence.

---

## 7. Query Risk & Enforcement

| Level | Trigger | Enforcement |
|-------|---------|-------------|
| **SAFE** | Read-only, within row cap, permitted objects | Auto-execute |
| **WARNING** | Sensitive table, large scan, missing `LIMIT` | User acknowledgment required |
| **CRITICAL** | `DELETE` / `DROP` / `TRUNCATE` / production write | Simulation + Reviewer approval (re-auth) |
| **SECURITY_INCIDENT** | Injection signature, forbidden object, privilege escalation | **Hard reject. No approval path. Logged.** |

**Critical design rule:** `CRITICAL` (legitimate but risky → approvable) and `SECURITY_INCIDENT` (attack → never approvable) are distinct branches. Reviewers can never approve an attack attempt.

---

## 8. Defense-in-Depth Layers

| # | Layer | Catches |
|---|-------|---------|
| 1 | Authentication (Keycloak OIDC + PASETO session) | Unauthenticated / forged-token access |
| 2 | Authorization (Cerbos, live attribute resolution) | Wrong-role / stale-permission access |
| 3 | Policy invariants (Cerbos DENY rules) | Org / environment / approval / PII overrides |
| 4 | Prompt-injection screen | Manipulated prompts |
| 5 | Schema filtering | Generation referencing forbidden objects |
| 6 | AST validation | Bad statement types, forbidden tables/columns, stacked statements |
| 7 | Row-filter injection (from Cerbos outputs) | Model omitting permission filters |
| 8 | Risk engine | Routing destructive/suspicious queries |
| 9 | TRE isolation (two tiers) | Credential exposure, exfiltration, blast radius |
| 10 | DB roles + RLS | Anything that bypassed the app layer |
| 11 | Immutable audit | Tampering, non-repudiation |
| 12 | Observability | Aggregate anomaly detection |

Validation: each layer is independently testable; disabling layer 6 should still leave layer 10 blocking a malicious query.

---

## 9. Execution Security (TRE) — Two Tiers

The TRE is the **only** component permitted to connect to customer databases. Execution is split by operation type; isolation is preserved in both.

**Read tier (warm pool)**
- Long-lived isolated workers; per-job `SET TRANSACTION READ ONLY`, `statement_timeout`, `pg-cursor` row caps.
- Credential is a Vault lease **renewed on a short cycle**, capped TTL, revoked on pod restart — short-lived and least-privilege, amortized across queries rather than minted per query.
- PII masking (per Cerbos `maskedColumns`) applied before results leave.

**Write tier (ephemeral, approved writes only)**
- Fresh single-use environment per approved write; **single-use** credential; destroyed after `COMMIT`.
- **Dry-run preview:** `BEGIN … RETURNING * … ROLLBACK` returns the exact rows that would change, with nothing committed — shown to the reviewer. No data copy, no merge step.
- **Post-approval:** the same validated SQL runs with `RETURNING *` and `COMMIT` — that commit is the change reaching production.
- `lock_timeout` + `statement_timeout` set; concurrency handled by Postgres MVCC/row locks (a blocked or timed-out write is logged as an audit event).

**Common to both tiers**
- **Network isolation:** no internet egress; reachable peers limited to Redis (jobs) and target databases (leased/JIT credentials).
- Phase 3 pod hardening: non-root, read-only root filesystem, dropped Linux capabilities, resource limits, `NetworkPolicy` egress allowlist.

---

## 10. Audit & Non-Repudiation

- Append-only `audit_logs`; `hash = SHA256(previous_hash + canonical_json(event))`.
- Captured per event: user, org, environment, prompt, generated SQL, final SQL, risk level, approval history, execution status, result metadata, timestamp, IP address.
- **Verify-integrity** recomputes the chain and flags tampering.
- **All events logged, including failed and rejected attempts** — security incidents are first-class audit entries.

---

## 11. Rate Limiting as a Security Control

| Layer | Protects against |
|-------|------------------|
| Cloudflare (per-IP) | Volumetric abuse at the edge |
| Application (`rate-limiter-flexible`, per-user/per-org) | Credential-stuffing, runaway LLM cost |
| Queue (BullMQ per-org concurrency) | One tenant exhausting shared resources or hammering the customer's own database |

---

## 12. Platform Hardening

- `helmet` on Express (security headers).
- **Zod validation** at every input boundary.
- HTTPS everywhere; strict CORS.
- **Trivy** container scanning + dependency auditing in CI.
- Secrets via environment / secret store, never committed.
- Cloudflare WAF rules at the edge.

---

## 13. Threat Model

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Prompt injection | Crafted prompt / poisoned data | Injection screen; SECURITY_INCIDENT reject; output never executed; re-validation |
| Malicious generated SQL | LLM error or manipulation | AST validation; allowlist; multi-statement reject; row-filter injection |
| Privilege escalation | Requesting elevated objects/actions | Live attribute resolution + Cerbos DENY invariants; DB grants + RLS backstop |
| Credential theft | Compromised service / logs | API holds no creds; envelope → Vault leases; redaction; short TTL |
| Data exfiltration | Reading more than permitted | TRE network isolation; PII masking pre-egress; row caps |
| Destructive operations | `DELETE`/`DROP`/`TRUNCATE` | Read-only read tier; writes need approval + dry-run; Cerbos production-write DENY |
| Concurrent write conflicts | Two writes to overlapping rows | Postgres MVCC + row locks + `lock_timeout`; conflict logged, not silently merged |
| Cross-tenant access | Missing scope checks | Cerbos org-scope rule + RLS on `org_id` at the DB layer |
| Audit tampering | DB row edits | Hash chain + verify-integrity |
| Resource exhaustion | Query floods | Three-layer rate limiting incl. per-org execution concurrency cap |
| Token forgery | `alg` confusion, replay | PASETO (no `alg:none`); OIDC validation against Keycloak JWKS; server-side session revocation |
| Stale permissions | Role change mid-session | Live attribute lookup + Cerbos decision every request |

---

## 14. Compliance-Aligned Practices

- Complete, immutable audit trail (supports accountability requirements).
- PII identification and masking policies.
- Least-privilege access and environment separation (dev/staging/prod).
- Data-minimization to the AI (only metadata, never data or credentials).
- Configurable retention and time-window policies per org.

---

## 15. Security Open Items

- Define audit-log retention windows and archival policy.
- Decide whether MFA is in scope for Reviewer/Admin roles.
- Define session lifetime and idle-timeout values.
- Establish a key-rotation schedule for PASETO keys and the envelope master key.
