# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

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

COPY --from=builder --chown=10001:10001 /app/.next/standalone ./
COPY --from=builder --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=builder --chown=10001:10001 /app/public ./public
# Keep downloadable import templates available even if Next's file tracer changes.
COPY --from=builder --chown=10001:10001 /app/server-assets ./server-assets
COPY --chown=10001:10001 --chmod=0555 deploy/healthcheck.sh ./deploy/healthcheck.sh

USER 10001:10001
EXPOSE 3000
CMD ["node", "server.js"]
