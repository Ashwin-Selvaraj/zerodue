# Build context is the repository root:  docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo

# Manifests first so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @zerodue/shared build && pnpm --filter @zerodue/api build

FROM build AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/api
EXPOSE 4000
# Apply pending migrations, then start. DATABASE_URL etc. come from the environment.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
