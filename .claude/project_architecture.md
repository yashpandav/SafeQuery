---
name: SafeQuery Architecture Invariants
description: Non-negotiable architectural rules and key decisions for SafeQuery that must never be violated
type: project
---

**Core invariants — never violate these:**

1. Core API (apps/api) never touches customer databases — only enqueues jobs via BullMQ. TRE is the only DB-facing component.
2. AI output is always untrusted input — parse with AST (node-sql-parser), run Cerbos decisions, rewrite before execution. Never execute raw LLM SQL.
3. Permissions resolved live per request via Cerbos — never cache authorization decisions in tokens.
4. Identity / auth / authorization are three separate tools: Keycloak = identity (who you are), PASETO = authentication proof, Cerbos = authorization (what you can do).
5. Custom roles are application data (DB rows), not code — org admins configure without redeploy.
6. Dry-run before commit: EXPLAIN for reads, transactional ROLLBACK for writes (preview), COMMIT is source of truth.
7. Append-only audit log with SHA-256 hash chain — tampering must be detectable.

**ADRs (don't reverse without discussion):**
- PostgreSQL-only v1 (Supabase/Neon/RDS/self-hosted all covered)
- Keycloak not hand-rolled auth
- PASETO not JWT (eliminates algorithm-confusion attacks)
- Cerbos not hand-rolled RBAC
- Drizzle ORM (migrations as code, RLS in schema)
- tRPC for internal APIs + trpc-to-openapi for REST surface via Scalar /docs
- No direct API→customer DB connection ever
- Hash-chain audit (not blockchain)

**How to apply:** Before implementing any feature involving auth, DB access, or query execution, verify these invariants are maintained. Flag any design that would violate them.
