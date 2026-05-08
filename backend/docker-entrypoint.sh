#!/usr/bin/env sh
# rx-assistant backend entrypoint.
#
# Runs Drizzle migrations BEFORE handing off to the long-running server, so
# the very first request to /api/chat hits a schema-current database.
# Migration script (src/db/migrate.ts) calls openDb({ migrate: true }) which
# is idempotent — running it on every boot is safe and cheap.
#
# `exec` is load-bearing: it replaces this shell with the Bun process so
# SIGTERM from `docker stop` reaches the runtime, not the shell wrapper.
# Without exec, compose's graceful-shutdown grace period would always
# expire and containers would be SIGKILL'd.

set -e

echo "[entrypoint] applying database migrations…"
bun run migrate

echo "[entrypoint] starting backend on :${PORT:-8787}"
exec "$@"
