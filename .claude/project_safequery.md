---
name: SafeQuery Project Overview
description: Core purpose, architecture invariants, tech stack, and build phases for the SafeQuery AI database governance platform
type: project
---

SafeQuery is an Enterprise AI Database Governance Platform — a control plane between an LLM and a real database. It validates AI-generated SQL as untrusted input, routes queries by risk level (SAFE/WARNING/CRITICAL/SECURITY_INCIDENT), executes in an isolated Trusted Runtime Environment (TRE), masks PII, and records everything in a tamper-evident hash-chain audit log.

**Why:** Employees paste AI-generated SQL directly into production DBs with no validation, no permission checks, no approval step, and no audit trail. SafeQuery replaces that.

**Tech Stack:** Next.js 16 + React 19 + tRPC 11 + Tailwind (web), Express + tRPC (API), Vercel AI SDK (ai-service), BullMQ + Redis (queue), PostgreSQL + Drizzle ORM + RLS (app DB), Keycloak (OIDC identity), PASETO v4 (tokens), Cerbos (authorization), node-sql-parser (AST), Pino + OpenTelemetry (observability). Monorepo: Turborepo + pnpm 9.

**Current state (as of 2026-06-16):** P0 scaffolding — apps/web exists (Next.js + tRPC client), packages/ui exists. No api, ai-service, tre-dispatcher, tre-executor, packages/auth, packages/db, packages/types yet.

**How to apply:** When working on any feature, check which phase it belongs to. Build P0 → P1 before P2+. P1 (full SAFE/WARNING/CRITICAL pipeline) is the critical differentiator and must be fully demoable before governance features.

**Full specs:** `Docs/PROOF_OF_CONCEPT.md` is the canonical reference. All docs in `Docs/` are authoritative.
