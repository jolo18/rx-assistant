# syntax=docker/dockerfile:1
# rx-assistant frontend
# Multi-stage: Bun builds the static dist/, nginx serves it + proxies /api/*
# to the backend service. Final image ~50 MB on the alpine-nginx base.

# ── Stage 1: Build the Vite bundle ────────────────────────────────────────────
FROM oven/bun:1-slim AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ── Stage 2: Serve via nginx ──────────────────────────────────────────────────
FROM nginx:1-alpine AS runtime

# nginx-alpine runs nginx as nginx (uid 101) by default — already non-root
# for the worker processes. The master process needs root only to bind <1024;
# we bind :80 inside the container, host maps to 5173.

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Compose's depends_on: service_healthy keys off this. wget is in busybox in
# alpine, no install needed.
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
    CMD wget --spider --quiet http://127.0.0.1:80/ || exit 1
