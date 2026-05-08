# syntax=docker/dockerfile:1
# rx-assistant backend
# Bun's slim Debian base — Bun's own production-image guidance. ~120 MB final.

FROM oven/bun:1-slim AS deps
WORKDIR /app
# Install ONLY production deps. --frozen-lockfile pins exact versions; --production
# omits everything in devDependencies (drizzle-kit, pino-pretty, typescript, etc.).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-slim AS runtime
WORKDIR /app

# ca-certificates for outbound TLS (OpenRouter); wget for the HEALTHCHECK.
# Drop apt lists after install to keep the image lean.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user (uid 1001, gid root for OpenShift compatibility).
# /data is the sqlite mountpoint; chown so the rx user can write.
RUN groupadd --system --gid 1001 rx \
    && useradd --system --uid 1001 --gid 1001 --create-home rx \
    && mkdir -p /data \
    && chown -R 1001:0 /data

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=1001:0 package.json bun.lock ./
COPY --chown=1001:0 src ./src
COPY --chown=1001:0 drizzle ./drizzle
COPY --chown=1001:0 docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

USER 1001

ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=/data/app.db \
    LOG_LEVEL=info \
    LOG_PRETTY=false

EXPOSE 8787

# Compose's depends_on.condition: service_healthy keys off this. wget --spider
# returns 0 only on HTTP 200; health endpoint returns 503 if the DB ping fails,
# which lets compose hold dependent services back during a degraded boot.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget --spider --quiet http://127.0.0.1:8787/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
