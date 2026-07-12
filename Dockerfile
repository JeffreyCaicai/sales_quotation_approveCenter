# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup --system --gid 10001 app \
 && adduser --system --uid 10001 --ingroup app --home /app --no-create-home app

COPY --from=production-dependencies --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /app/.next/standalone ./
COPY --from=builder --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=builder --chown=10001:10001 /app/public ./public
# Keep downloadable import templates available even if Next's file tracer changes.
COPY --from=builder --chown=10001:10001 /app/server-assets ./server-assets
COPY --from=builder --chown=10001:10001 /app/drizzle ./drizzle
COPY --chown=10001:10001 --chmod=0555 deploy/healthcheck.sh deploy/migrate-production.mjs ./deploy/

# A SHA-only installer extracts this bundle from the already pulled immutable image.
COPY --chown=10001:10001 docker-compose.yml /opt/release-bundle/docker-compose.yml
COPY --chown=10001:10001 deploy /opt/release-bundle/deploy

USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
