# Phase 4 — DevOps & Infrastructure

> **Phase 1 reference:** `specs/archive/phase-1-agentic-streaming-backend.md` (closed at `62f81f3`).
> **Phase 2 reference:** `specs/archive/phase-2-frontend.md` (closed at `2a680b2`).
> **Phase 3 reference:** `specs/archive/phase-3-voice.md` (closed at `3badd52`).
> **Verification baseline:** `cd backend && bun test` → 170 / 170; `cd frontend && bun run test` → 220 / 220.

---

## 1. Goal & success criteria (verbatim from the assignment)

| # | Deliverable | Definition of done |
| --- | --- | --- |
| 1 | `docker-compose.yml` | Brings up the backend (and frontend, if containerized) with a single command. Dependent services start **only after their dependencies are healthy** — proven with `depends_on.condition: service_healthy`. |
| 2 | `Dockerfile` (backend) | Minimal image, production-only deps, runs as a **non-root** user. |
| 3 | Automated migration | Drizzle migrations run **before** the backend accepts traffic. Documented in the README. |
| 4 | `.env.example` | Every env var labelled — REQUIRED / DEFAULT / SECRET — so a fresh contributor can fill it in. |
| 5 | (Bonus) GitHub Actions CI | Builds the image, brings the stack up, polls `/health`, runs the test suite. Fails fast on any non-zero exit. |

End-of-phase ships when the assignment's reviewer can run:

```sh
git clone <repo> && cd rx-assistant
cp backend/.env.example backend/.env   # then fill in OPENROUTER_API_KEY
docker compose up
```

…and have a working backend on `http://localhost:8787` (and frontend on `http://localhost:5173` if containerized) without running `bun install` themselves.

---

## 2. Architecture

```
┌────────────────────────────┐         ┌──────────────────────────────────┐
│  frontend (nginx + dist/)  │  /api/* │  backend (Bun + Hono + sqlite)   │
│  :80 → host :5173          │ ──────▶ │  :8787, runs migrations on boot  │
│  static + SSE proxy        │         │  /health endpoint for compose    │
└────────────────────────────┘         └────────────────┬─────────────────┘
                                                        │
                                                        ▼
                                          ┌─────────────────────────┐
                                          │ docker volume `sqlite`  │
                                          │   /data/app.db          │
                                          └─────────────────────────┘
```

- **No separate DB service** — SQLite is in-process, persisted via a named docker volume. The "healthy dependency" pattern is demonstrated by the frontend service waiting for the backend's healthcheck (not by waiting on a Postgres container, which we don't have).
- **OpenRouter is external.** Backend reaches it over the host network; no compose entry needed.

---

## 3. Decisions to lock at slice 23 entry

Open a single bundled `AskUserQuestion` covering these four; default to the recommendations.

1. **Containerize frontend?** — Yes (nginx + static `dist/`) vs No (backend-only). Recommend **yes**: it makes the "depends-on healthy" rule applicable + lets the bonus CI run the full stack.
2. **Image base** — `oven/bun:1-slim` (~120 MB Debian-slim) vs `oven/bun:1-alpine` (~80 MB but musl quirks). Recommend **`oven/bun:1-slim`** per Bun's own production guidance.
3. **CI provider** — GitHub Actions vs other (CircleCI, GitLab). Recommend **GitHub Actions** — assignment explicitly mentions it.
4. **Deployment target** — local-only docker compose vs aim at a hosted target (fly.io / railway). Recommend **local-only** — the assignment asks for compose, not for a deployed URL. Hosted deploy is out of scope.

---

## 4. Slice plan (TDD-driven where applicable; per the project pause-for-review discipline)

Slice numbering continues from Phase 3 (slice 22). **Three slices** (or four if CI is split out).

### Slice 23 — Backend Dockerfile + automated migration

**Tests first** — Not directly testable without the daemon, but we add a minimal `backend/tests/integration/health.test.ts` smoke that hits the existing `GET /health` to make sure the route doesn't regress between phases. (Already covered by slice-7 tests; this is just an explicit pin.)

**Impl** —
- `backend/Dockerfile` — `oven/bun:1-slim`. Multi-step: deps install (`--frozen-lockfile --production`), copy `src/` + `drizzle/`, non-root `rx` user (uid 1001), `/data` directory chown'd to that user. `HEALTHCHECK` calls `wget --spider http://localhost:8787/health || exit 1` (no curl in slim).
- `backend/docker-entrypoint.sh` — single command: runs `bun run migrate` then exec's `bun run start`. The `exec` is important so signals (SIGTERM from compose) reach the Bun process, not the shell.
- `backend/.dockerignore` — `node_modules`, `tests`, `data/`, `*.md`, `.env*`. Keeps the build context tight.

**DoD** — `cd backend && docker build -t rx-assistant-backend .` succeeds; `docker run --rm -e OPENROUTER_API_KEY=… rx-assistant-backend` starts the server, runs migrations, accepts traffic on `:8787`. Container runs as uid 1001.

### Slice 24 — docker-compose.yml + frontend container + .env.example labels + README

**Impl** —
- `docker-compose.yml` at the repo root:
  - `backend` service builds from `./backend/Dockerfile`, mounts a `sqlite-data:/data` named volume, healthcheck via the Dockerfile's `HEALTHCHECK`. Reads env from `./backend/.env`.
  - `frontend` service builds from `./frontend/Dockerfile`, depends on `backend.condition: service_healthy`, exposes `:80` on host `:5173`. Maps `/api/*` to `backend:8787` via `nginx.conf` with `proxy_buffering off` (critical for SSE).
- `frontend/Dockerfile` — multi-stage. Stage 1 `oven/bun:1-slim` runs `bun install --frozen-lockfile && bun run build`. Stage 2 `nginx:1-alpine` copies `dist/` + the proxy config.
- `frontend/nginx.conf` — `try_files $uri /index.html` for SPA routing; `location /api/` upstream to `backend:8787` with SSE-friendly headers.
- `backend/.env.example` — every var annotated **`# REQUIRED`**, **`# DEFAULT: …`**, or **`# SECRET`** so a new contributor can scan it once.
- README updated with a "Run with Docker" section: `docker compose up`, env-file step, log paths, the migration explainer.

**DoD** — `docker compose up` from a clean clone builds both images, starts backend, waits for `/health` to return 200, then starts frontend. `http://localhost:5173/` loads, sends a healthcare prompt, streams an SSE response end-to-end. Killing compose cleans up the named volume on `--volumes`.

### Slice 25 — CI workflow + Phase 4 closure

**Impl** —
- `.github/workflows/ci.yml`:
  - Job `test`: matrix `[backend, frontend]`. Steps: checkout → `oven-sh/setup-bun@v2` → install → `bun test` → `bun run typecheck`.
  - Job `compose`: needs `test`. Steps: checkout → write a fake `OPENROUTER_API_KEY` env → `docker compose up -d --build` → wait-for-health loop (`timeout 60 sh -c 'until curl -fs http://localhost:8787/health; do sleep 2; done'`) → run a small smoke test (`curl /health` + `curl /api/conversations`) → `docker compose down -v`.
  - Both jobs `fail-fast: true`.
- README extended with CI badge + a sentence on the workflow.
- `specs/phase-4-deploy-ci.md` → `specs/archive/`; CLAUDE.md marks Phase 4 closed; memory file flips active → closed.

**DoD** — A GitHub Actions run on a PR ticks every job green; a forced failure (e.g. break a backend test) ticks red and `compose` doesn't start. The repo's README displays the badge.

---

## 5. Failure modes (deploy-side)

| ID | Trigger | Symptom | Mitigation |
| --- | --- | --- | --- |
| D-F-1 | Migration script fails (corrupt sqlite, schema mismatch) | Backend crashes on boot; `/health` never returns 200; compose times out the dependent frontend | Entrypoint exits non-zero → compose surfaces the failure. README's run-book points at `docker logs rx-assistant-backend` for the migration error. |
| D-F-2 | `OPENROUTER_API_KEY` missing | Backend boots fine but every `/api/chat` 500s | `.env.example` calls it out as REQUIRED. README's Run-with-Docker step has `cp .env.example .env` as a literal command. |
| D-F-3 | nginx buffers SSE | Frontend chunks arrive in a burst at the end | `proxy_buffering off` in `frontend/nginx.conf` (called out as load-bearing in the file's comment header). |
| D-F-4 | Stale build artifacts | Code changes don't take | `docker compose up --build` is the documented dev loop. CI uses `--build` unconditionally. |
| D-F-5 | Volume not created | sqlite writes fail with permission denied | `Dockerfile` `RUN chown -R 1001:0 /data` + compose declares the named volume. |
| D-F-6 | Bun version drift | Local works, container fails | `oven/bun:1-slim` pins the major. CI uses `oven-sh/setup-bun@v2` with `bun-version-file: backend/package.json` (or pinned literal). |

---

## 6. Out of scope (Phase 4)

- **Hosted deployment** (fly.io, railway, AWS) — local docker compose only.
- **TLS / reverse-proxy hardening** — nginx in our compose is local-dev grade. Real prod would put Caddy or Traefik in front.
- **Multi-replica backend** — single instance; sqlite is single-writer.
- **Container observability** (Prometheus, Grafana) — out of scope.
- **Database migrations rollback** — Drizzle's forward-only migration model is what backend ships; rollback is manual SQL.
- **Backups** — sqlite volume snapshots are a host concern; documented but not automated here.

---

## 7. Sign-off (decisions log — locked at slice 23 entry)

| Axis | Decision | Notes |
| --- | --- | --- |
| Image base | `oven/bun:1-slim` | Bun's own prod guidance; ~120 MB final image. |
| Frontend container | yes | Lets the depends-on-healthy rule apply; lets CI test the full stack. |
| CI provider | GitHub Actions | Two jobs (test matrix + compose smoke), fail-fast, build on PR + push to main. |
| Deployment target | local-only docker compose | Hosted out of scope. |
| Migration trigger | entrypoint script (`bun run migrate && exec bun run start`) | Healthcheck is the gate the frontend / CI waits on. |
| Volume | named volume `sqlite-data:/data` | Survives `compose down`; cleared with `compose down -v`. |
| User | non-root uid 1001 (`rx`) | Container best practice; volume chown'd on image build. |

Phase 4 closes when the assignment's run-flow works end-to-end and the CI workflow demonstrates a passing run on a PR.
