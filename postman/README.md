# Testing SafeQuery end-to-end with Postman

This exercises the real pipeline against real Postgres/Redis/Keycloak/Cerbos —
no mocks. Import both files in this folder into Postman first:
`SafeQuery.postman_collection.json` and `SafeQuery.postman_environment.json`
(select the environment in Postman's top-right dropdown before running anything).

## 1. Start infra

```bash
docker compose -f infra/docker/docker-compose.yml up -d
docker compose -f infra/docker/docker-compose.yml ps   # wait for all healthy
```

`infra/docker/.env` already exists with generated dev defaults — nothing to fill in here.

## 2. Set your OpenAI key

`apps/ai-service/.env` has a placeholder — replace it:

```
OPENAI_API_KEY=sk-...your real key...
```

Every other `.env` file (`apps/api`, `apps/ai-service`, `apps/tre-dispatcher`) already has
generated PASETO/credential keys filled in. Don't reuse these for anything beyond local dev.

## 3. Migrate the database

```bash
pnpm install
pnpm --filter @repo/db db:migrate
# then apply RLS (psql must be on your PATH, or use any Postgres client):
psql postgresql://safequery:safequery_dev@localhost:5434/safequery -f packages/db/src/rls-policies.sql
```

## 4. Start the apps

```bash
pnpm dev
```

This starts `apps/api` (:3001), `apps/ai-service` (:3002), and `apps/tre-dispatcher`
(the BullMQ worker — no port, just watch its terminal output). `apps/tre-dispatcher`
**must** be running before any `databaseConnection.*` or `query.submit` call, since
those enqueue a job and wait for it.

## 5. Run the Postman collection, in order

**Folder 1 (Keycloak Auth) → Folder 2 (SafeQuery Auth):** run every request in both
folders once, for both users. This creates the `users` rows in our DB (via
`auth.exchangeToken`) that the seed script needs.

**Seed the demo org:**

```bash
pnpm --filter @repo/db db:seed
```

Copy the three printed values (`orgId`, `devEnvironmentId`, `prodEnvironmentId`) into
the Postman environment, replacing the `REPLACE — printed by...` placeholders.

**Folder 3 (Database Connections):** creates two connections (dev + prod, same physical
`customer_demo` database seeded by `infra/docker/postgres/init.sql` — only the
environment *classification* differs) and captures their schemas.

**Folder 4 (Submit Queries):** four requests showing all four risk paths:
- **SAFE** — bounded read, executes immediately, returns real rows
- **WARNING** — unbounded read, still executes immediately (no ack-step UI yet)
- **CRITICAL** — write against the prod-classified connection; returns a real dry-run
  simulation (`RETURNING * ... ROLLBACK`, nothing committed) and creates an approval
  request
- **SECURITY_INCIDENT** — prompt-injection attempt, hard-rejected before any model call

**Folder 5 (Approval Decision):** approve or reject the CRITICAL request from folder 4
**as the reviewer**, not the analyst — there's a request demonstrating the four-eyes
rule rejecting the analyst's own attempt to approve it. Approving re-runs and commits
the exact validated SQL for real.

## Inspecting what actually happened

```bash
pnpm --filter @repo/db db:studio
```

Opens Drizzle Studio — check `query_logs` (status/riskLevel/rowCount per submission),
`approval_requests` (simulationResult, decidedAt), and `audit_logs` (the full hash-chain
trail: `QUERY_SUBMITTED`, `QUERY_EXECUTED`, `APPROVAL_REQUESTED`, `APPROVAL_APPROVED`, etc).

To see the actual customer data change after approving the CRITICAL write:

```bash
psql postgresql://demo_analyst:demo_analyst_dev@localhost:5434/customer_demo -c "SELECT * FROM customers;"
```

## If something fails

- **`PRECONDITION_FAILED` from query.submit** — you skipped Capture Schema for that connection.
- **`FORBIDDEN` from query.submit** — the seed script hasn't run, or didn't find the
  user (check you ran Exchange Token for that user first).
- **Job timeout / no response from query.submit or databaseConnection.\*** — `apps/tre-dispatcher`
  isn't running, or it can't reach Redis (check its terminal output).
- **`databaseConnection.create` returns `BAD_REQUEST: Connectivity test failed`** —
  `apps/tre-dispatcher` can't reach Postgres on `localhost:5434`; confirm
  `docker compose ps` shows postgres healthy and the port mapping matches `infra/docker/.env`.
- **`riskLevel: SECURITY_INCIDENT` on a query you expected to be SAFE** — check
  `apps/ai-service`'s terminal output; either `OPENAI_API_KEY` is wrong/missing, or the
  model genuinely flagged something (the `riskReason` in the response says why).
