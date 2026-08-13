FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS workspace-manifests
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/orchestrator/package.json apps/orchestrator/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/agent-core/package.json packages/agent-core/package.json
COPY packages/codex-provider/package.json packages/codex-provider/package.json
COPY packages/course-authoring-kit/package.json packages/course-authoring-kit/package.json
COPY packages/curriculum/package.json packages/curriculum/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/exercise-core/package.json packages/exercise-core/package.json
COPY packages/learning-core/package.json packages/learning-core/package.json
COPY packages/opencode-provider/package.json packages/opencode-provider/package.json
COPY packages/prompt-library/package.json packages/prompt-library/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/testing/package.json packages/testing/package.json

FROM workspace-manifests AS build-dependencies
RUN npm ci --no-audit --no-fund

FROM build-dependencies AS builder
ENV NODE_ENV=production
COPY . .
RUN npm run build --workspace=@aptiloop/orchestrator && \
    test ! -e apps/orchestrator/dist/server.js.map

FROM workspace-manifests AS production-dependencies
RUN npm ci --omit=dev --workspace=@aptiloop/orchestrator \
      --include-workspace-root=false --no-audit --no-fund && \
    rm -rf node_modules/@aptiloop && \
    test -e node_modules/@hono/node-server && \
    test -e node_modules/@earendil-works/pi-agent-core && \
    test -e node_modules/@opencode-ai/sdk && \
    test ! -e node_modules/next && \
    test ! -e node_modules/tsx && \
    test ! -e node_modules/tsup && \
    test ! -e node_modules/typescript && \
    test ! -e node_modules/vitest

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS runner
LABEL org.opencontainers.image.source="https://github.com/nayvok/Aptiloop"
LABEL org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV ORCHESTRATOR_BIND_MODE=container-loopback-published
ENV DATABASE_URL=/data/dev-learning-harness.sqlite
ENV WORKSPACE_ROOT=/app/workspaces/exercises
ENV EXERCISE_ATTEMPTS_ROOT=/app/.data/exercise-attempts
WORKDIR /app

# Git is required for immutable exercise baselines and evidence. Python 3 is
# required by the advertised Core Python environment. Neither is assumed to be
# present in the slim Node base image.
RUN apt-get update && \
    apt-get install --yes --no-install-recommends git python3 && \
    rm -rf /var/lib/apt/lists/* && \
    git --version && \
    python3 --version && \
    groupadd --system aptiloop && \
    useradd --system --gid aptiloop --home-dir /app aptiloop && \
    mkdir -p /data /app/.data/exercise-attempts /app/workspaces/exercises && \
    chown -R aptiloop:aptiloop /data /app/.data

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder --chown=aptiloop:aptiloop /app/apps/orchestrator/dist ./apps/orchestrator/dist
COPY --from=builder /app/packages/database/migrations ./packages/database/migrations
COPY --from=builder /app/LICENSE /app/NOTICE /app/THIRD_PARTY_NOTICES.md ./
COPY --from=production-dependencies /app/node_modules/@hono/node-server/LICENSE ./third-party-licenses/hono-node-server-LICENSE
COPY --from=production-dependencies /app/node_modules/hono/LICENSE ./third-party-licenses/hono-LICENSE
COPY --from=production-dependencies /app/node_modules/zod/LICENSE ./third-party-licenses/zod-LICENSE
RUN ORCHESTRATOR_BIND_MODE=invalid node apps/orchestrator/dist/server.js 2>&1 | \
      grep -F "ORCHESTRATOR_BIND_MODE must be direct or container-loopback-published"

# Project notices and available direct runtime dependency license texts are
# retained in /app. THIRD_PARTY_NOTICES.md identifies upstream terms for npm
# packages whose published archives do not include a standalone license file.
# Development curriculum and exercise fixtures are intentionally absent. A
# fresh production profile is empty, and unknown trusted-template IDs fail
# explicitly instead of acquiring executable content from a Course Pack.
USER aptiloop
EXPOSE 8787
CMD ["node", "apps/orchestrator/dist/server.js"]
