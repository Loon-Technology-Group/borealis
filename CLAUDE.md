# CLAUDE.md — Step 4: Dockerfile + CI Workflows

This file provides guidance for adding the multi-stage Dockerfile and two GitHub Actions
workflows: `ci.yml` (PR validation) and `release.yml` (build + push to Docker Hub).

## Goal

- A single multi-stage `Dockerfile` in `docker/` that builds either binary from the
  Cargo workspace using a build argument
- `ci.yml` — runs on every pull request: fmt, clippy, test
- `release.yml` — runs on push to `main` and on manual trigger: cross-compiles both
  binaries for `aarch64-unknown-linux-gnu`, builds minimal Docker images, pushes to
  Docker Hub tagged with both `latest` and the git SHA

No Rust code, frontend, or Terraform changes in this step.

---

## File Structure

```
borealis/
├── docker/
│   ├── Dockerfile
│   └── docker-compose.prod.yml
└── .github/
    └── workflows/
        ├── ci.yml
        └── release.yml
```

---

## `docker/Dockerfile`

Multi-stage build. The builder stage is x86_64 but produces an aarch64 binary via
cross-compilation. The runtime stage is a minimal arm64 image.

```dockerfile
# syntax=docker/dockerfile:1

# ── Stage 1: cross-compile the binary ────────────────────────────────────────
FROM --platform=linux/amd64 rust:latest AS builder

# Install the aarch64 cross-compilation target
RUN rustup target add aarch64-unknown-linux-gnu

# Install the C cross-linker for aarch64
RUN apt-get update && apt-get install -y \
    gcc-aarch64-linux-gnu \
    && rm -rf /var/lib/apt/lists/*

# Configure cargo to use the aarch64 linker
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc

WORKDIR /app
COPY . .

# CRATE build arg selects which binary to build (borealis-collector or borealis-api)
ARG CRATE
ENV SQLX_OFFLINE=true

RUN cargo build --release --target aarch64-unknown-linux-gnu -p ${CRATE}

# ── Stage 2: minimal arm64 runtime image ─────────────────────────────────────
FROM --platform=linux/arm64 debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG CRATE
COPY --from=builder /app/target/aarch64-unknown-linux-gnu/release/${CRATE} /usr/local/bin/app

# frontend/ must be mounted or present at runtime for borealis-api
# borealis-collector has no static file dependency

CMD ["/usr/local/bin/app"]
```

### Notes on the Dockerfile

- `--platform=linux/amd64` on the builder stage ensures the builder always runs as
  x86_64 on GitHub Actions runners regardless of the `--platform` flag passed to
  `docker buildx build`
- `--platform=linux/arm64` on the runtime stage produces the correct image manifest
  for the t4g EC2 instance
- `SQLX_OFFLINE=true` is set in the builder so sqlx uses the committed `.sqlx/` cache
  instead of requiring a live database at build time
- The binary name in the release stage matches the crate name exactly — confirm that
  `cargo build -p borealis-collector` produces `target/.../borealis-collector` and
  `cargo build -p borealis-api` produces `target/.../borealis-api`. If the binary
  names differ from the crate names, adjust the `COPY` path accordingly by checking
  each `Cargo.toml` for a `[[bin]]` section.

---

## `docker/docker-compose.prod.yml`

Used on the EC2 host. Pulls pre-built images from Docker Hub rather than building
locally. Postgres is internal-only (no host port exposed). Only the API exposes a port.

```yaml
services:
  postgres:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_DB: borealis
      POSTGRES_USER: borealis
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    # No ports: block — intentionally internal only

  collector:
    image: loontechcraig/borealis-collector:latest
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://borealis:${POSTGRES_PASSWORD}@postgres:5432/borealis
      USER_AGENT: ${USER_AGENT}
      KP_URL: ${KP_URL}
      BZ_URL: ${BZ_URL}
      WIND_URL: ${WIND_URL}

  api:
    image: loontechcraig/borealis-api:latest
    restart: unless-stopped
    depends_on:
      - postgres
    ports:
      - "443:443"
    volumes:
      - ./certs:/certs:ro
      - ./frontend:/app/frontend:ro
    environment:
      DATABASE_URL: postgresql://borealis:${POSTGRES_PASSWORD}@postgres:5432/borealis
      TLS_CERT_PATH: /certs/origin.pem
      TLS_KEY_PATH: /certs/origin.key

volumes:
  pgdata:
```

### Notes on prod compose

- `frontend/` is bind-mounted into the API container at `/app/frontend` so ServeDir
  can find it at runtime. The working directory for the binary inside the container
  is `/` by default — adjust the ServeDir path in `borealis-api` if needed, or add
  `WORKDIR /app` to the Dockerfile runtime stage and ensure the binary is copied there
- `certs/` contains the Cloudflare Origin Certificate — provisioned manually on the
  host, never committed to the repo
- TLS integration in the API binary is a later step — the port mapping is included
  here for completeness but the API currently binds HTTP on 3000. Update the port
  mapping to `"3000:3000"` until TLS is wired in, then switch to 443.

---

## `.github/workflows/ci.yml`

Runs on every pull request. Validates formatting, lints, and tests. Does not build
Docker images. Does not require Docker Hub credentials.

```yaml
name: CI

on:
  pull_request:
    branches:
      - main

env:
  CARGO_TERM_COLOR: always
  SQLX_OFFLINE: "true"

jobs:
  check:
    name: Check
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - name: Cache cargo registry and build artifacts
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target/
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-

      - name: Check formatting
        run: cargo fmt --all --check

      - name: Clippy
        run: cargo clippy --workspace -- -W warnings

      - name: Test
        run: cargo test --workspace
```

### Notes on ci.yml

- `dtolnay/rust-toolchain@stable` always installs the latest stable Rust — no pinned
  version, consistent with the project's stance on always tracking stable
- `SQLX_OFFLINE=true` must be set so sqlx compile-time query checking uses `.sqlx/`
  cache rather than attempting a database connection
- Cache key is based on `Cargo.lock` — cache is invalidated when dependencies change
- Clippy uses `-W warnings` (warn but don't fail) as specified
- No database service container needed — sqlx offline mode covers compile-time checks
  and there are no integration tests requiring a live DB at this stage

---

## `.github/workflows/release.yml`

Runs on push to `main` and on manual trigger (`workflow_dispatch`). Cross-compiles
both binaries for aarch64, builds arm64 Docker images, pushes to Docker Hub with
`latest` and git SHA tags.

```yaml
name: Release

on:
  push:
    branches:
      - main
  workflow_dispatch:

env:
  CARGO_TERM_COLOR: always
  SQLX_OFFLINE: "true"

jobs:
  build-and-push:
    name: Build and Push — ${{ matrix.crate }}
    runs-on: ubuntu-latest

    strategy:
      matrix:
        crate:
          - borealis-collector
          - borealis-api

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-unknown-linux-gnu

      - name: Cache cargo registry and build artifacts
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target/
          key: ${{ runner.os }}-cargo-aarch64-${{ matrix.crate }}-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-aarch64-${{ matrix.crate }}-

      - name: Install aarch64 cross-linker
        run: |
          sudo apt-get update
          sudo apt-get install -y gcc-aarch64-linux-gnu

      - name: Configure cargo cross-linker
        run: |
          mkdir -p ~/.cargo
          cat >> ~/.cargo/config.toml <<EOF
          [target.aarch64-unknown-linux-gnu]
          linker = "aarch64-linux-gnu-gcc"
          EOF

      - name: Build aarch64 binary
        run: cargo build --release --target aarch64-unknown-linux-gnu -p ${{ matrix.crate }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Extract git SHA tag
        id: sha
        run: echo "short=$(git rev-parse --short HEAD)" >> $GITHUB_OUTPUT

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile
          platforms: linux/arm64
          push: true
          build-args: |
            CRATE=${{ matrix.crate }}
          tags: |
            loontechcraig/${{ matrix.crate }}:latest
            loontechcraig/${{ matrix.crate }}:${{ steps.sha.outputs.short }}
          cache-from: type=gha,scope=${{ matrix.crate }}
          cache-to: type=gha,mode=max,scope=${{ matrix.crate }}
```

### Notes on release.yml

- The matrix runs both crates in parallel — two jobs, two images, independent caches
- Cross-compilation is done directly with `cargo build --target aarch64-unknown-linux-gnu`
  rather than the `cross` tool — this avoids Docker-in-Docker complexity on the runner
  since we're already in a Docker build context
- `cache-from/cache-to: type=gha` uses GitHub Actions cache for Docker layer caching
  scoped per crate — significantly speeds up subsequent builds
- Git SHA is shortened to 7 characters via `git rev-parse --short HEAD`
- The Dockerfile `COPY . .` in the builder stage copies the full workspace including
  the pre-built binary in `target/` — but since we're running `cargo build` inside
  the Dockerfile builder stage (not copying a pre-built binary), the cross-compilation
  happens inside Docker. This is consistent and correct.
- `workflow_dispatch` with no inputs — manual trigger requires no parameters, just
  runs against the current HEAD of `main`

---

## GitHub Actions Secrets Required

Add these in the repository settings under **Settings → Secrets and variables →
Actions**:

| Secret name | Value |
|-------------|-------|
| `DOCKERHUB_USERNAME` | `loontechcraig` |
| `DOCKERHUB_TOKEN` | Docker Hub access token (not your password — generate at hub.docker.com → Account Settings → Security) |

Do not use your Docker Hub password directly. Generate a personal access token with
Read/Write scope for the `borealis-collector` and `borealis-api` repositories.

---

## Docker Hub Repository Setup

Before the first release workflow run, create the two repositories on Docker Hub:

- `loontechcraig/borealis-collector` — set to Public
- `loontechcraig/borealis-api` — set to Public

Public repositories are required for the EC2 host to pull images without credentials
on the host. If you prefer private repositories, you will need to add Docker Hub
credentials to the EC2 host and run `docker login` before `docker compose pull`.

---

## Verification

### CI workflow

1. Open a pull request against `main` (even a trivial change)
2. Confirm the `CI / Check` job triggers automatically
3. Confirm all three steps pass: fmt check, clippy, test
4. Confirm `SQLX_OFFLINE=true` prevents any database connection attempts

### Release workflow

1. Merge a PR to `main` and confirm the release workflow triggers automatically
2. Confirm both matrix jobs run in parallel
3. Confirm both jobs complete successfully
4. Confirm Docker Hub shows new tags on both repositories:
   - `loontechcraig/borealis-collector:latest`
   - `loontechcraig/borealis-collector:<sha>`
   - `loontechcraig/borealis-api:latest`
   - `loontechcraig/borealis-api:<sha>`
5. Test manual trigger: **Actions → Release → Run workflow** and confirm it runs
   against `main` and produces updated tags

### Local Dockerfile validation (optional but recommended)

```bash
# Build collector image locally for amd64 to verify Dockerfile syntax
# (aarch64 cross-compile locally requires the same gcc-aarch64-linux-gnu setup)
docker build \
  --build-arg CRATE=borealis-collector \
  -f docker/Dockerfile \
  -t borealis-collector:local \
  .

docker build \
  --build-arg CRATE=borealis-api \
  -f docker/Dockerfile \
  -t borealis-api:local \
  .
```

---

## What Is NOT Changing in This Step

- No Rust code changes
- No frontend changes
- No Terraform
- EC2 deployment and TLS are handled in later steps
- The `docker-compose.yml` (local dev, Postgres only) is not modified
