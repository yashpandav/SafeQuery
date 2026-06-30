FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Stage 1: prune the monorepo to only what @repo/api needs ─────────────────
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @repo/api --docker

# ── Stage 2: install dependencies from the pruned lockfile ───────────────────
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# ── Stage 3: build ────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=installer /app/node_modules ./node_modules
COPY --from=pruner /app/out/full/ .
# Restore per-package node_modules (workspace symlinks + hoisted deps)
COPY --from=installer /app/node_modules ./node_modules
RUN pnpm --filter @repo/api build

# ── Stage 4: minimal runtime image ───────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nodejs

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/apps/api/dist ./dist

USER nodejs
EXPOSE 3001

CMD ["node", "dist/index.js"]
