FROM node:24.15.0-bookworm-slim AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/orchestrator/package.json apps/orchestrator/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/agent-core/package.json packages/agent-core/package.json
COPY packages/codex-provider/package.json packages/codex-provider/package.json
COPY packages/curriculum/package.json packages/curriculum/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/exercise-core/package.json packages/exercise-core/package.json
COPY packages/learning-core/package.json packages/learning-core/package.json
COPY packages/opencode-provider/package.json packages/opencode-provider/package.json
COPY packages/prompt-library/package.json packages/prompt-library/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/testing/package.json packages/testing/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
ARG ORCHESTRATOR_URL
ARG ORCHESTRATOR_BIND_MODE
ENV ORCHESTRATOR_URL=${ORCHESTRATOR_URL}
ENV ORCHESTRATOR_BIND_MODE=${ORCHESTRATOR_BIND_MODE}
COPY . .
RUN npm run build --workspace=@dlh/web

FROM node:24.15.0-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN groupadd --system harness && useradd --system --gid harness --home-dir /app harness
COPY --from=builder --chown=harness:harness /app/apps/web/.next/standalone ./
COPY --from=builder --chown=harness:harness /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=harness:harness /app/apps/web/public ./apps/web/public
USER harness
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
