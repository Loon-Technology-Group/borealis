# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Borealis is a Rust workspace with three crates that collect, store, and serve solar wind and geomagnetic data from NOAA's Space Weather Prediction Center (SWPC):

- **borealis-db** — shared database layer (models, migrations, queries)
- **borealis-collector** — polls NOAA APIs every 60s and writes to PostgreSQL
- **borealis-api** — Axum REST API server + static file serving for the frontend SPA

## Commands

```bash
# Build
cargo build                        # debug, all crates
cargo build --release
cargo build -p borealis-api        # single crate

# Test / Lint (CI uses SQLX_OFFLINE=true)
SQLX_OFFLINE=true cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace -- -W warnings

# Run locally (set env vars first — see .env.example)
docker-compose up -d               # start PostgreSQL 17
cargo run -p borealis-collector
cargo run -p borealis-api          # http://localhost:3000 (set SKIP_TLS=true)

# Docker (ARM64 production image)
docker buildx build --platform linux/arm64 --build-arg CRATE=borealis-api -f docker/Dockerfile .
```

## Environment Variables

See `.env.example`. Key variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `KP_URL` / `BZ_URL` / `WIND_URL` | NOAA data source URLs |
| `USER_AGENT` | HTTP user agent for NOAA requests |
| `SKIP_TLS` | Set `true` for local dev (HTTP on port 3000 instead of HTTPS on 443) |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | Required when `SKIP_TLS` is unset/false |

## Architecture

### Data Flow
```
NOAA SWPC APIs → borealis-collector (every 60s) → PostgreSQL → borealis-api → frontend SPA
```

### borealis-db
Shared crate used by both services. `run_migrations()` is called at startup by each binary. Database operations use upsert (`ON CONFLICT DO NOTHING`) keyed on `time_tag` (TIMESTAMPTZ UNIQUE).

Three tables: `kp` (K-index), `bz` (magnetic field, 12 REAL columns), `wind` (density/speed/temperature).

### borealis-api Routes
```
GET /api/kp|bz|wind     — accepts ?window=1h|3h|6h|12h|24h (default 6h)
GET /api/latest         — latest reading from all three streams
```
Static files served from `frontend/` directory as SPA fallback.

### CI/CD
- **ci.yml** — runs on PRs: fmt + clippy + tests (`SQLX_OFFLINE=true`)
- **release.yml** — on push to main: builds aarch64 binaries, pushes to Docker Hub (`loontechcraig/*`) tagged with git SHA

## Infrastructure

Terraform in `infra/` deploys to AWS us-east-2 on an EC2 t4g.small (ARM/Graviton, Debian 12). Uses Cloudflare DNS and Tailscale VPN. State stored in S3 + DynamoDB (`borealis-tfstate-loontechcraig`).
