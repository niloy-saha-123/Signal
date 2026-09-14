# Multi-stage production image for the Signal API server and BullMQ worker processes.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci --ignore-scripts --workspace=@signal/shared --workspace=@signal/api --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npm run build -w @signal/shared && npm run build -w @signal/api

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci --ignore-scripts --workspace=@signal/shared --workspace=@signal/api --include-workspace-root --omit=dev
RUN npx --no-install playwright install --with-deps chromium \
    && chown -R node:node /ms-playwright /app

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

WORKDIR /app/apps/api
EXPOSE 3000
USER node

FROM runtime AS worker
CMD ["node", "dist/worker.js"]

FROM runtime AS runner
CMD ["node", "dist/api/index.js"]
