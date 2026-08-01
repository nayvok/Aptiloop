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
COPY . .
RUN npm run build --workspace=@dlh/orchestrator

FROM node:24.15.0-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV DATABASE_URL=/data/dev-learning-harness.sqlite
ENV WORKSPACE_ROOT=/app/workspaces/exercises
ENV EXERCISE_ATTEMPTS_ROOT=/app/.data/exercise-attempts
WORKDIR /app
RUN groupadd --system harness && useradd --system --gid harness --home-dir /app harness
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder --chown=harness:harness /app/apps/orchestrator/dist ./apps/orchestrator/dist
COPY --from=builder --chown=harness:harness /app/packages/database/migrations ./packages/database/migrations
COPY --from=builder --chown=harness:harness /app/workspaces/exercises ./workspaces/exercises
RUN mkdir -p /data /app/.data/exercise-attempts && \
    chown -R harness:harness /data /app/.data
USER harness
EXPOSE 8787
CMD ["node", "apps/orchestrator/dist/server.js"]
