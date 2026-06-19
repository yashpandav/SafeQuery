# SafeQuery — Tech Stack Guide (Learn It, Explain It)

This document exists for one purpose: so you can explain *this specific codebase* — not the
general concept of "what is tRPC" — to someone else (an interviewer, a teammate, your future
self in six months). Every section below is anchored to a real file in this repo. When you're
asked "walk me through how a query gets executed," skip to **Part 8** and follow the file paths.

Read order: Parts 1–7 build up the individual pieces. Part 8 wires them together into the one
flow that matters most (`query.submit`). Part 9 is a cheat-sheet of "if asked X, say Y" for the
architectural decisions you'll most likely get pushed on.

---

## Part 0 — The one-sentence mental model

SafeQuery is a **control plane that sits between an AI and a real database**. It never executes
AI-generated SQL directly — it parses it, asks a policy engine if it's allowed, classifies how
risky it is, and routes it through one of four paths (auto-run / ack-and-run / human-approve / hard
-reject) before a separate, credential-isolated component ever touches the customer's database.

Six pieces of technology make that possible, and each one answers a *different* question:

| Question | Technology | Where |
|---|---|---|
| "How do `apps/api` and `apps/web` talk to each other with full type safety?" | **tRPC** | Part 2 |
| "How is this *codebase* organized so 9 apps/packages build/test together sanely?" | **Turborepo** | Part 1 |
| "Who is this user, really?" (identity) | **Keycloak** | Part 3 |
| "Prove this request came from someone who already logged in" (a session credential) | **PASETO** | Part 4 |
| "Is this specific user allowed to do this specific thing to this specific row?" (authorization) | **Cerbos** | Part 5 |
| "Where does the AI's SQL actually get run against a real database, safely?" | **TRE** (Trusted Runtime Environment — our own term, not a library) | Part 6 |

Notice the pattern in the identity/security stack: **Keycloak answers "who," PASETO answers "prove
it," Cerbos answers "may they."** Three separate tools, three separate concerns, on purpose
(see `CLAUDE.md`'s invariant #4). This separation is the single most important architectural
decision to be able to defend out loud.

---

## Part 1 — Turborepo (the monorepo build system)

### What it's for

A monorepo means many independently-versioned packages live in one git repo
(`apps/api`, `apps/web`, `packages/auth`, etc.) instead of nine separate repos. The problem a
plain monorepo creates: if you run `pnpm test` at the root, do you want to re-run *every*
package's tests every time, even the ones you didn't touch? Turborepo solves exactly this:
task orchestration + caching across a dependency graph.

### How it's configured here

`turbo.json` (repo root) declares **tasks**, not packages — each package's own `package.json`
defines what `dev`/`build`/`lint`/etc. actually *do*; turbo just orchestrates *when* and *whether
to re-run* them:

```json
"test": { "dependsOn": ["^build"] }
```

The `^` prefix means "this package's *dependencies'* build tasks must finish first, in topological
order" — e.g. `apps/api` depends on `@repo/sql-validator`, so `^build` makes sure
`@repo/sql-validator` is built before `apps/api`'s tests run against it.

`dev` and `db:migrate` are marked `"cache": false` — caching a long-running dev server or a
stateful DB write would be actively wrong (you always want them to actually run).

### The "source package" pattern — why there's no build step for `packages/*`

Look at any package's `package.json`, e.g. `packages/auth/package.json`:

```json
"exports": { ".": "./src/index.ts" }
```

It points straight at a `.ts` file, not a compiled `dist/`. Combined with
`"moduleResolution": "Bundler"` in the shared tsconfig, this means **packages never need their own
build step** — whatever consumes them (`tsx`, `tsup`, Next.js) compiles the TypeScript itself.
This is *why* `pnpm --filter @repo/auth test` works instantly after you edit `packages/auth/src/`
with zero rebuild step in between. Apps (`apps/api`, `apps/web`) *do* build (`tsup`, `next build`)
because they're the actual deployable artifact; packages are not.

### Commands you'll actually use

```bash
pnpm --filter @repo/api test      # just one package
pnpm test                          # everything, parallelized + cached
pnpm dev                           # all apps, --persistent, never cached
```

If asked "why Turborepo and not Nx/Lerna" — the honest answer for this project is simply: it's
the zero-config default for a pnpm-workspace TypeScript monorepo, has first-class pnpm support,
and the caching model is exactly what a CI pipeline needs later (remote cache, not used yet here
but the door is open).

---

## Part 2 — tRPC (typed RPC, no REST/GraphQL schema layer)

### What it's for

Normally, a frontend calling a backend either hand-writes `fetch()` calls against a REST API (no
compile-time guarantee the URL/shape is right) or maintains a GraphQL schema (a second source of
truth to keep in sync). tRPC's trick: the **backend's router type itself** is the contract. The
frontend imports that *type* (never the backend's code) and gets full autocomplete + compile
errors if a field is renamed — with zero codegen step.

### The procedure hierarchy — `apps/api/src/trpc/init.ts`

This is the part worth being able to draw on a whiteboard. Three tiers, each wrapping the last:

```typescript
export const baseProcedure = t.procedure
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.sessionId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' })
  }
  return next({ ctx: { ...ctx, user: ctx.user, sessionId: ctx.sessionId } })
})
export const orgProcedure = authedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.orgId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'X-Org-Id header is required for this endpoint' })
  }
  const membership = await ctx.db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.orgId, ctx.orgId), eq(organizationMembers.userId, ctx.user.id)),
  })
  if (!membership) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization' })
  return next({ ctx: { ...ctx, orgId: ctx.orgId, platformRole: membership.platformRole } })
})
```

- `baseProcedure` — anyone, no token (e.g. `health.check`, `auth.exchangeToken` itself — you need
  an *unauthenticated* endpoint to hand out the first session token).
- `authedProcedure` — needs a valid PASETO session token. Note `.use()` is **middleware
  chaining** — each tier literally builds on the previous tRPC procedure object, so `orgProcedure`
  automatically gets `authedProcedure`'s guarantee that `ctx.user` exists, for free.
  TypeScript even *narrows* `ctx.user` from `User | null` to `User` after this middleware runs —
  that's the `next({ ctx: { ...ctx, user: ctx.user } })` trick: re-stating a non-null value back
  into context changes its inferred type for every procedure downstream.
- `orgProcedure` — needs the same, *plus* an `X-Org-Id` header that must match a real
  `organization_members` row for this user. This is where **multi-tenancy boundary enforcement**
  starts — every org-scoped endpoint (`query.submit`, `databaseConnection.*`, `approval.decide`)
  uses this tier, so it is structurally impossible to write a new endpoint that forgets to check
  org membership.

### Context — what every procedure receives

```typescript
export async function createTRPCContext({ req, res }: { req: Request; res: Response }) {
  const token = extractBearerToken(req.headers.authorization)
  // ... verifySession(token, ...) -> user, sessionId (or both stay null)
  const orgIdHeader = req.headers['x-org-id']
  return { user, sessionId, orgId, db, cerbos, req, res }
}
```

Context is built **fresh on every single request** — `db` and `cerbos` are shared singleton
clients (created once at startup, see `apps/api/src/lib/db.ts` / `lib/cerbos.ts`), but `user`/
`sessionId`/`orgId` are re-resolved from scratch each time. This matters: it's *why* invariant #3
("permissions resolved live, never cached in tokens") is actually true in this codebase and not
just a documented intention — there's no code path where a stale cached permission could leak in.

### Routers — `apps/api/src/trpc/routers/_app.ts`

```typescript
export const appRouter = createTRPCRouter({
  auth: authRouter, health: healthRouter, query: queryRouter,
  databaseConnection: databaseConnectionRouter, approval: approvalRouter,
})
export type AppRouter = typeof appRouter
```

That exported **type** (`AppRouter`) is the entire contract. `apps/web` imports it for its client;
`apps/api` itself calls `apps/ai-service` the same way (see below) using `apps/ai-service`'s own
exported `AppRouter` type — tRPC isn't just frontend↔backend, it's used **service-to-service**
here too.

### Service-to-service tRPC — `apps/api/src/lib/ai-service-client.ts`

```typescript
const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({
    url: `${env.AI_SERVICE_URL}/trpc`,
    headers: async () => {
      const token = await signServiceToken({ service: 'api' }, env.SERVICE_PRIVATE_KEY)
      return { authorization: `Bearer ${token}` }
    },
  })],
})
```

Every single call to `apps/ai-service` signs a **fresh 5-minute PASETO v4.public token** (Part 4)
right before the call — there's no long-lived service credential sitting around to leak.

### tRPC wire format (useful if you ever test with Postman/curl directly)

Non-batch calls: `GET /trpc/health.check`, queries take `?input=<URI-encoded JSON>`; mutations
(`POST /trpc/query.submit`) send the input as the raw JSON body — *not* wrapped in `{0: ...}`
(that wrapping is `httpBatchLink`-only, for batching multiple calls into one HTTP request).

---

## Part 3 — Keycloak (identity — "who are you")

### What it's for

Keycloak is an off-the-shelf, open-source **Identity Provider** (IdP) implementing OIDC (OpenID
Connect, which is OAuth2 + an identity layer on top). The deliberate decision here
(`CLAUDE.md`'s ADR list) was **not** to hand-roll a username/password/JWT system — Keycloak gives
you password policies, MFA, social login, and crucially, the ability for an enterprise customer to
plug in *their own* IdP (Okta, Azure AD, etc.) later via the same OIDC federation, with zero code
change in `apps/api`.

### Key concepts you'll be asked about

- **Realm** (`infra/docker/keycloak/safequery-realm.json`, realm name `safequery`) — an isolated
  tenant of users/clients/roles inside Keycloak itself. (Don't confuse this with SafeQuery's *own*
  multi-tenancy — `organizations` in our Postgres DB. Keycloak's realm is one level up: it's
  "this whole SafeQuery deployment's" user directory, not one customer org's.)
- **Client** — an application allowed to request tokens from a realm. Two exist:
  `safequery-web` (public, PKCE — a browser can't keep a secret) and `safequery-api`
  (confidential — a server can).
- **JWKS** (JSON Web Key Set) — the realm publishes its public signing keys at a well-known URL
  (`/realms/safequery/protocol/openid-connect/certs`). Anyone verifying a token fetches that
  public key — they never need Keycloak's private key, and Keycloak never needs to be *online* at
  request-verification-time beyond serving that endpoint.

### The actual verification code — `packages/auth/src/keycloak.ts`

```typescript
const jwks = createRemoteJWKSet(new URL(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`))
const { payload } = await jwtVerify(token, jwks, { issuer: `${keycloakUrl}/realms/${realm}` })
```

`jose`'s `createRemoteJWKSet` handles fetching + caching + rotating those public keys
automatically. This is a **standard JWT** (Keycloak issues regular OIDC JWTs) — note this is the
*only* place in the codebase JWT appears. The moment SafeQuery's *own* session is created, it
switches to PASETO (next section). Keycloak's JWT never leaves `auth.exchangeToken` — it's
verified once, then immediately traded in for a SafeQuery-native token.

### Why a token exchange step at all? — `apps/api/src/trpc/routers/auth.ts`

```typescript
exchangeToken: baseProcedure
  .input(z.object({ keycloakToken: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    const kcPayload = await verifyKeycloakToken(input.keycloakToken, {...})
    const [user] = await ctx.db.insert(users).values({ keycloakId: kcPayload.sub, email: kcPayload.email, ... })
      .onConflictDoUpdate({ target: users.keycloakId, set: {...} }).returning()
    const sessionToken = await signSession({ userId: user.id, sessionId: randomUUID() }, env.PASETO_LOCAL_KEY)
    return { sessionToken, user: {...} }
  })
```

This does three things in one step: (1) verifies the Keycloak token is real, (2) **upserts** a
local `users` row (first login creates it, every later login just updates `email`/`name` if
they changed in Keycloak — `onConflictDoUpdate` on the unique `keycloakId`), (3) mints a SafeQuery
session token. From this point on, `apps/api` never has to talk to Keycloak again for this
session — everything rides on the PASETO token until it expires (8h) and the user re-authenticates.

---

## Part 4 — PASETO (the session/service token format — "prove it")

### Why not just JWT, since Keycloak already gave us one?

JWT's biggest real-world footgun: the **algorithm is part of the token's own header**, and a
server that naively trusts that header can be tricked (the classic `alg: none` or
RS256→HS256 key-confusion attacks — verify with the *wrong* algorithm using a key intended
for a different one). PASETO's whole design principle is **versioned, non-negotiable**
cipher suites — `v3.local` always means one specific AES-CTR+HMAC construction, full stop, no
"alg" field an attacker could swap. You don't have to *audit* a PASETO token's algorithm
choice; it's a property of which decrypt function you called.

### Two flavors, two completely different jobs

| | `v3.local` | `v4.public` |
|---|---|---|
| Used for | User session tokens | Service-to-service calls (`api` → `ai-service`) |
| Crypto | Symmetric (AES-256-CTR + HMAC-SHA384) — **one shared secret** | Asymmetric (Ed25519 sign/verify) — **a keypair** |
| Who can read the payload | Anyone holding the one secret key (it's *encrypted*, not just signed) | Anyone — it's signed, not encrypted; the payload is plaintext-but-tamper-proof |
| Why this flavor | Only `apps/api` itself ever needs to read a session payload — one shared key is fine and simpler | The *caller* (`apps/api`) and *verifier* (`apps/ai-service`) are different processes; a shared secret would mean either side leaking it compromises the other. A keypair means `apps/api` holds the private (signing) half, `apps/ai-service` only ever needs the public (verifying) half — even if `ai-service` is fully compromised, it can't forge a token *as* `apps/api`. |

(Why not `v4.local` for sessions too, for consistency? Documented limitation, not a choice:
the `paseto` npm package doesn't implement XChaCha20, which `v4.local` requires. It *does*
implement `v4.public`. `v3.local` was the available symmetric option.)

### `v3.local` — sessions, `packages/auth/src/paseto.ts`

```typescript
function localKeyFromHex(hexKey: string) {
  const buf = Buffer.from(hexKey, 'hex')
  if (buf.length !== 32) throw new Error('PASETO_LOCAL_KEY must be exactly 32 bytes (64 hex characters)')
  return createSecretKey(buf)
}
export async function signSession(payload: SessionPayload, hexKey: string, options = {}) {
  return V3.encrypt(payload, localKeyFromHex(hexKey), { expiresIn: options.expiresIn ?? '8h' })
}
export async function verifySession(token: string, hexKey: string) {
  return V3.decrypt(token, localKeyFromHex(hexKey))
}
```

`PASETO_LOCAL_KEY` is one 64-hex-character (32-byte) secret, generated once
(`crypto.randomBytes(32).toString('hex')`), living in `apps/api/.env` only. `signSession` is
called exactly once, in `auth.exchangeToken`. `verifySession` is called on **every single
authenticated request**, inside `createTRPCContext` (Part 2) — if it throws (expired/tampered/
wrong key), `ctx.user` simply stays `null` and `authedProcedure`'s middleware rejects with
`UNAUTHORIZED`. There is deliberately no separate "is this token valid" check — invalidity and
"no token at all" are handled by the exact same code path.

### `v4.public` — service-to-service, `packages/auth/src/service-token.ts`

```typescript
export function generateServiceKeypairBase64() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey: Buffer.from(publicKey).toString('base64'), privateKey: Buffer.from(privateKey).toString('base64') }
}
export async function signServiceToken(payload, privateKeyBase64, options = {}) {
  return V4.sign(payload, privateKeyFromBase64(privateKeyBase64), { expiresIn: options.expiresIn ?? '5m' })
}
export async function verifyServiceToken(token, publicKeyBase64) {
  return V4.verify(token, publicKeyFromBase64(publicKeyBase64))
}
```

One Ed25519 keypair is generated **once**, ever, for the whole `api` ↔ `ai-service` relationship.
The private half (`SERVICE_PRIVATE_KEY`) lives only in `apps/api/.env`; the public half
(`SERVICE_PUBLIC_KEY`) lives only in `apps/ai-service/.env` — neither app holds the other's
half. Tokens are minted fresh per-call with a 5-minute expiry (see Part 2's `ai-service-client.ts`
snippet), so even a captured token is useless almost immediately.

---

## Part 5 — Cerbos (authorization — "may they")

### What it's for, and why not just `if` statements in the code

You *could* write `if (user.role === 'admin') { ... }` scattered through the codebase. The
problem: as soon as you need per-org custom roles, row-level filters, and column masking that
admins configure *without a redeploy*, those `if` statements become an unauditable mess spread
across dozens of files, and every change requires a code review + deploy. Cerbos externalizes
this into one **Policy Decision Point** (PDP) — a separate server you ask "can principal P do
action A on resource R?" and it answers from declarative YAML policies, hot-reloadable without
touching app code.

### The vocabulary

- **Principal** — who's asking (a user, identified by id + roles + arbitrary `attr`ibutes).
- **Resource** — what they're asking about (a `kind` + `id` + `attr`ibutes).
- **Derived role** — a role *computed at decision time* from attributes, not stored anywhere
  (e.g. "is this principal in the same org as this resource AND a submitter" → `same_org_submitter`).
  Cerbos convention: derived roles live in their own files
  (`infra/docker/cerbos/policies/derived_roles_*.yaml`), imported by resource policies via
  `importDerivedRoles:` — this repo follows that convention strictly.
- **Condition / CEL** — the actual boolean logic, written in Google's CEL
  (Common Expression Language) — a small, sandboxed expression language, *not* arbitrary code.
- **Output** — a policy rule can return arbitrary data alongside `ALLOW`/`DENY` — this is the
  mechanism that hands back *row filters* and *masked columns*, not just a yes/no.

### The one policy worth memorizing — `infra/docker/cerbos/policies/db_table.yaml`

```yaml
resourcePolicy:
  resource: "db_table"
  rules:
    - actions: ["select", "insert", "update", "delete"]
      effect: EFFECT_ALLOW
      roles: ["*"]
      condition:
        match:
          all:
            of:
              - expr: request.resource.attr.org_id == request.principal.attr.org_id
              - expr: request.resource.id in request.principal.attr.table_scope
              - expr: request.action in request.principal.attr.capabilities
      output:
        when:
          ruleActivated:
            expr: '{"rowFilter": request.principal.attr.row_filter, "maskedColumns": request.principal.attr.masked_columns}'
```

Read this out loud as: "Allow any role to do any of select/insert/update/delete on a `db_table`
resource **if and only if** the resource's org matches the principal's org, **and** the table name
is in the principal's allowed table list, **and** the action is in the principal's allowed
capability list. If all that's true, also hand back the row filter and masked-column list this
principal is configured with." Notice `roles: ["*"]` — this policy is deliberately
**attribute-only**, not Cerbos-role-based, because the actual authorization unit here is
SafeQuery's own *custom role* (`custom_roles` DB table, configurable per org), flattened into
`principal.attr` before the call. Cerbos's built-in role system (`Owner`/`Admin`/`Reviewer`/etc.)
is used for the *other* policies (`query.yaml`, `approval_request.yaml`) where platform-level
roles genuinely are the right unit.

### The client wrapper — `packages/policy-client`

`packages/policy-client/src/client.ts` deliberately does **not** type `CerbosClient` as the full
`@cerbos/http` `HTTP` class — it's narrowed to an interface with just the one method
(`checkResources`) this codebase calls:

```typescript
export interface CerbosClient {
  checkResources(request: CheckResourcesRequest): Promise<CerbosCheckResponse>
}
export function createCerbosClient(cerbosUrl: string): CerbosClient {
  return new HTTP(cerbosUrl)
}
```

Why this matters for explaining your own code: it's a small but real example of **depending on an
interface, not a concrete implementation** — the real `HTTP` client satisfies this interface for
free (it has a superset of methods), and unit tests can hand in a plain object literal as a fake
Cerbos server with zero `any` casts, because the interface only demands what's actually used.

`packages/policy-client/src/check.ts` is where every resource type gets its own typed helper
(`checkQuery`, `checkApproval`, `checkDatabaseConnection`, `checkAuditLog`, `checkDbTable`) —
each one just builds the right `principal`/`resource` shape and calls the one generic `check()`.
One detail worth knowing if you read the code: requests use `attr` (not the older, deprecated
`attributes` field some Cerbos SDK examples still show) — `attr` is the current field name;
Cerbos's policy CEL always reads `request.principal.attr.*` regardless of which SDK field name
sent the data, so this is purely a "use the current API" choice, not something that changes
behavior.

### Why every request, never cached

Re-read invariant #3: **"permissions resolved live — never cache in tokens; every request calls
Cerbos for a fresh decision."** This is *why* an org admin can edit a custom role's `allowedTables`
in the DB and have it take effect on a user's *very next request* — there is no token to
invalidate, no cache to bust, because the decision was never stored anywhere to begin with.

---

## Part 6 — TRE (Trusted Runtime Environment)

**This one is not a third-party technology — it's SafeQuery's own architectural concept**, and
the part most worth being able to explain in your own words, since nobody can look it up for you.

### The problem it solves

Invariant #1: **"Core API never touches customer databases."** Why would you ever want that?
Because `apps/api` is the thing exposed to the internet, handling auth, and running arbitrary
business logic — it's the highest-blast-radius component if compromised. If it also held
customer DB credentials and ran SQL directly, a vulnerability in *any* of its dozens of
dependencies becomes a direct path to every customer's data. The TRE is the answer: **one
narrow, deliberately small component is the only thing that ever opens a `pg` connection to a
customer database**, and it's the only place a master encryption key
(`CREDENTIAL_MASTER_KEY`) exists at all.

### The actual shape of it in this repo (and why it's two apps)

```
apps/api  --enqueue job-->  Redis (BullMQ queue)  --consumed by-->  apps/tre-dispatcher
                                                                          |
                                                                   imports + calls
                                                                          v
                                                                  apps/tre-executor
                                                                  (the only pg.Client in the whole repo)
```

- **`apps/tre-dispatcher`** (`apps/tre-dispatcher/src/index.ts`) is the actual *running process*
  — a BullMQ `Worker`. It is deliberately thin:
  ```typescript
  const worker = createExecutionWorker(connection, async (job) => handleJob(job.data), env.WORKER_CONCURRENCY)
  ```
  That's it. Routing *is* its entire job.
- **`apps/tre-executor`** is **not its own running service** — it has no `dev`/`start` script.
  It's a plain library of handler functions that `tre-dispatcher` imports and calls in-process
  (`handleJob()`). This is a documented, deliberate Phase-1 simplification of "BullMQ +
  worker_threads" — true OS-level process isolation per write is a Phase-3 upgrade
  (container-per-write), not silently skipped. If asked "isn't that the same process, so not
  *actually* isolated yet?" — the honest answer is yes, and that's written down, not hidden.

### Why a queue at all, instead of `apps/api` calling `tre-executor` as a function directly

Two reasons, and both matter: (1) it makes invariant #1 **true by construction** —
`apps/api`'s `package.json` literally has no `pg` dependency, so even a compromised `apps/api`
*cannot* open a database connection, there's no code path for it; a direct function call would
require importing the executor's code (and its `pg` dependency) into `apps/api`'s own process.
(2) it's the natural seam for the Phase-3 upgrade — swapping "in-process call" for "separate
container" later only changes what's on the *other end* of the queue, `apps/api`'s code doesn't
change at all.

### The producer side — `apps/api/src/lib/execution-queue.ts`

```typescript
export const executionQueue: ExecutionQueueClient = {
  async run(data) {
    const job = await queue.add(data.type, data)
    return job.waitUntilFinished(queueEvents, 60_000)  // 60s timeout
  },
}
```

`apps/api` enqueues a job and **awaits its result** — from the caller's point of view inside
`query-pipeline.ts`, this looks exactly like an async function call. The queue is invisible
plumbing, not a different programming model — that's a deliberate ergonomics choice
(`packages/queue`'s whole point).

### The four job types — `packages/queue/src/jobs.ts` (contracts), handled in `apps/tre-executor/src/lib/*.ts`

| Job | What it does | Key safety detail |
|---|---|---|
| `test_connection` | Connects with raw plaintext creds, runs `SELECT 1` | **Encrypts on success** — the only place a new connection's credentials are ever encrypted, since the master key only lives here |
| `capture_schema` | Queries `information_schema.columns` | Flags likely-PII columns by *name* (a hint for the AI prompt — Cerbos's `maskedColumns` output is the real enforcement, not this heuristic) |
| `execute_read` | `BEGIN TRANSACTION READ ONLY`, cursor-fetch `rowCap + 1` rows, `ROLLBACK` — or, when `explainOnly: true`, runs `EXPLAIN (FORMAT JSON) <sql>` instead and never fetches a row | The `+1` row is how it detects truncation without a separate `COUNT(*)`; masks columns before returning. `explainOnly` is the WARNING path's simulation — same read-only transaction, same `ROLLBACK`, just a planner estimate instead of real rows |
| `execute_write` | `BEGIN`, append `RETURNING *`, then `ROLLBACK` (dry-run) or `COMMIT` (after approval) | The dry-run *is* a real transaction that really runs — it just never commits, so the "preview" is exact, not a guess |

---

## Part 7 — node-sql-parser & the validator (the piece that ties Cerbos to actual SQL)

Worth a short mention since it's the glue between "Cerbos says yes" and "the SQL that actually
runs." `packages/sql-validator` parses the AI's SQL into an **AST** (not a string) using
`node-sql-parser`, so it can reason about table/column names structurally — string matching on
raw SQL is exactly how SQL-injection-style smuggling attacks work (e.g. hiding a second statement
in a comment), so the validator never trusts the string itself, only the parsed AST, and always
returns a **rewritten** version (with Cerbos's row filter injected as a real AST node, never
string-concatenated) for execution — the original AI-generated string is never executed, only
ever logged.

---

## Part 8 — Putting it all together: one `query.submit` call, start to finish

This is the flow to have memorized — it's the single best answer to "walk me through what
happens when a user asks a question."

1. **Browser → `apps/api`**: `POST /trpc/query.submit` with `Authorization: Bearer <PASETO v3.local
   session token>` and `X-Org-Id: <org>`.
2. **`createTRPCContext`** (Part 2) calls `verifySession()` (Part 4) — bad/expired token → `ctx.user`
   stays `null` → `orgProcedure`'s middleware throws `UNAUTHORIZED` before the handler ever runs.
3. **`orgProcedure`** middleware checks `organization_members` for this user+org → no row →
   `FORBIDDEN`.
4. **`submitQuery()`** (`apps/api/src/lib/query-pipeline.ts`) resolves the caller's `customRoleId`
   → their `customRoles.config` (no role assigned → `FORBIDDEN`, by design — there is no
   "default" permission set).
5. Resolves the target `databaseConnections` + its `environments.type`, and the latest
   `schemaSnapshots` row — filters that schema down to *only* the tables/columns the custom role
   allows (**before** anything is sent to the AI — the AI never sees a table it isn't allowed to
   query).
6. **`apps/ai-service.ai.generate`** is called over tRPC, authenticated with a fresh 5-minute
   PASETO v4.public token (Part 4) — generates SQL + a risk hint. If its own injection-screen
   already flagged the prompt as `SECURITY_INCIDENT`, there's no SQL to validate — skip straight
   to step 9.
7. **`validateSql()`** (Part 7) parses the AST, calls **`checkDbTable()`** (Part 5) per table
   referenced (live Cerbos call — not cached), injects the returned row filter, checks for
   missing `LIMIT`/excessive joins/unfiltered destructive writes, and classifies risk:
   `SAFE | WARNING | CRITICAL | SECURITY_INCIDENT`. Any *error*-severity violation (forbidden
   table, parse failure, unauthorized column) is **always** `SECURITY_INCIDENT` — there's no
   approval path for those, unlike `CRITICAL`.
8. A `query_logs` row is persisted, and a `QUERY_SUBMITTED` audit entry is written
   (`packages/audit` — hash-chained, Part-9-worthy on its own if asked).
9. **Branch on risk level** (Part 6's queue is what actually runs the SQL):
   - **SAFE** → enqueue `execute_read` *immediately*, update `query_logs` to `EXECUTED`/`FAILED`,
     return masked rows in the same HTTP response.
   - **WARNING** → enqueue `execute_read` with `explainOnly: true` — no rows fetched, just the
     planner's `Plan Rows` estimate, returned as `query_logs.simulationResult` with
     `status = 'AWAITING_ACKNOWLEDGMENT'`. Nothing executes yet; the response tells the caller
     `requiresAcknowledgment: true`.
   - **CRITICAL** → enqueue `execute_write` with `dryRun: true` (a real `ROLLBACK`ed transaction,
     exact preview), store the result as `approval_requests.simulationResult`, create the
     approval request. Nothing has touched real data yet.
   - **SECURITY_INCIDENT** → persist as `FAILED`, write a `SECURITY_INCIDENT_DETECTED` audit
     entry, nothing enqueued, no approval path exists to bypass.
10. For a WARNING query, the *same* caller later calls **`query.acknowledge`** with the
    `queryLogId` — CONFLICT unless still `AWAITING_ACKNOWLEDGMENT`, FORBIDDEN unless they're the
    original submitter (this is a self-service continuation of a request they already had
    authorized, not a new Cerbos decision). On success it re-enqueues `execute_read` for real
    (`explainOnly` unset) using the exact `rowCap`/`maskedColumns` persisted on `query_logs` at
    submit time, then updates `EXECUTED`/`FAILED` just like the SAFE path.
11. For a CRITICAL query: a **Reviewer** first calls **`approval.list`**, which Cerbos filters down
    to what they're allowed to `read` in one batched `checkResources` call (reviewers see every
    request in the org; analysts only see ones they submitted) — then **`approval.decide`**.
    Cerbos's four-eyes `DENY` rule (in `approval_request.yaml`) rejects if
    `submitted_by == principal.id` — the submitter literally cannot approve their own write,
    enforced by policy, not an `if` in `apps/api`. On approval, the **same validated SQL** is
    enqueued again as `execute_write` with `dryRun: false` — nothing is copied from the earlier
    dry-run; this fresh `COMMIT` is the only thing that ever reaches production data.

Every step above writes to the hash-chained `audit_logs` table — that's `packages/audit`'s job
(`writeAuditLog()`, using `SELECT ... FOR UPDATE` to serialize concurrent writers so the hash
chain can't fork), and it's why "0 blind executions, 100% of state-changing actions logged" is a
property of the code, not a claim about intentions.

**One more endpoint worth knowing about, even though it's outside the query lifecycle:**
`organization.list` is `authedProcedure`, not `orgProcedure` — it's how the web login page
discovers which orgs a user belongs to (and lets them pick one) without an org already selected,
which is exactly why it can't require `X-Org-Id` the way every other procedure in this list does.

---

## Part 9 — Cheat-sheet: "if asked X, say Y"

**"Why three separate tools (Keycloak/PASETO/Cerbos) instead of one auth library?"**
Each answers a different question and changes for a different reason. Identity (Keycloak) changes
when you add SSO providers. Token format (PASETO) changes if you ever swap session storage
strategy. Authorization (Cerbos) changes constantly — every org admin editing a custom role is an
authorization change — and that one needs to be hot-reloadable without touching the other two at
all.

**"Why PASETO over JWT, given Keycloak already speaks JWT?"**
Keycloak's JWT is *industry-standard for IdP↔app communication* — fine, it's a one-time exchange.
But SafeQuery's *own* session token is reissued and re-verified on every request for 8 hours
straight — that's the token worth hardening against algorithm-confusion attacks, and PASETO
removes that attack class by construction (versioned, non-negotiable ciphers) rather than by
careful library configuration.

**"Why is the TRE a queue instead of a function call?"**
Because it makes "the API can never touch a customer DB" a property you can verify by running
`pnpm why pg` in `apps/api` and seeing nothing — not a code-review rule someone could violate
in a future PR.

**"Isn't `tre-executor` running in-process inside `tre-dispatcher` defeating the isolation point?"**
Partially, today — yes. It's a documented Phase-1 simplification, not a hidden gap: the queue
boundary already gives you the *credential* isolation (only this process ever decrypts
`CREDENTIAL_MASTER_KEY`) and the *blast-radius* isolation from `apps/api` specifically. True
OS-level isolation *per write* (separate container/worker_thread) is the Phase-3 upgrade, and
because the boundary is already a queue, that upgrade only touches what's on the other side of
`packages/queue` — zero changes needed in `apps/api`.

**"What happens if Cerbos is down?"**
Every authenticated, org-scoped action calls Cerbos live — if it's unreachable, `checkResources()`
throws, the tRPC call fails closed (no policy decision → no default-allow anywhere in this
codebase). There is no local fallback cache to silently degrade into.

**"How do you know the audit log wasn't tampered with?"**
`verifyIntegrity()` (`packages/audit`) walks every row for an org in insertion order and
recomputes each row's hash from its own content + the *previous* row's stored hash — if any row's
content changed after the fact, or a row was deleted, the chain breaks at that exact point and
`verifyIntegrity` reports the first mismatched row. You don't have to trust the log was never
edited; you can prove it wasn't.
