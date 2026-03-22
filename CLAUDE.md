# CLAUDE.md — Step 7: TLS Support in borealis-api

This file provides guidance for adding TLS support to `borealis-api` using
`axum-server` with `rustls`. TLS is enabled by default and can be disabled via
environment variable for local homelab use.

## Goal

- When `SKIP_TLS` is unset or `false`: bind HTTPS on port 443 using the Cloudflare
  Origin Certificate at the paths specified by `TLS_CERT_PATH` and `TLS_KEY_PATH`
- When `SKIP_TLS=true`: bind plain HTTP on port 3000, existing behavior
- No other behavior changes — routes, ServeDir, database logic all unchanged

---

## Dependency Changes

### `crates/borealis-api/Cargo.toml`

Add `axum-server` with the `tls-rustls` feature. Remove or replace the current
`axum::serve` / `tokio::net::TcpListener` approach — `axum-server` handles both
the TLS and non-TLS cases cleanly.

```toml
axum-server = { version = "0.7", features = ["tls-rustls"] }
```

Add to `[workspace.dependencies]` in the root `Cargo.toml` first, then reference
with `workspace = true` in the api crate.

Do NOT add `openssl` or any OpenSSL-related crates. `axum-server` with `tls-rustls`
is pure Rust — no system OpenSSL dependency.

---

## Environment Variables

Two new variables, both read in `main.rs`:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SKIP_TLS` | bool-like string | `false` | Set to `true` to disable TLS and bind HTTP on port 3000 |
| `TLS_CERT_PATH` | string | required when TLS enabled | Path to PEM-encoded certificate file |
| `TLS_KEY_PATH` | string | required when TLS enabled | Path to PEM-encoded private key file |

Parsing `SKIP_TLS`:
```rust
let skip_tls = std::env::var("SKIP_TLS")
    .unwrap_or_default()
    .to_lowercase() == "true";
```

When `skip_tls` is `false`, read `TLS_CERT_PATH` and `TLS_KEY_PATH` and panic with
a clear message if either is missing:
```rust
let cert_path = std::env::var("TLS_CERT_PATH")
    .expect("TLS_CERT_PATH must be set when SKIP_TLS is not true");
let key_path = std::env::var("TLS_KEY_PATH")
    .expect("TLS_KEY_PATH must be set when SKIP_TLS is not true");
```

---

## `src/main.rs` Changes

Replace the current `tokio::net::TcpListener` + `axum::serve` block with a
conditional dispatch on `skip_tls`. The router construction is unchanged — build
the router identically regardless of TLS mode, then hand it to either the TLS or
plain HTTP server.

```rust
use axum_server::tls_rustls::RustlsConfig;

// ... existing router construction unchanged ...

if skip_tls {
    let addr = "0.0.0.0:3000".parse().unwrap();
    tracing::info!("TLS disabled — listening on http://{}", addr);
    axum_server::bind(addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
} else {
    let config = RustlsConfig::from_pem_file(&cert_path, &key_path)
        .await
        .expect("failed to load TLS certificate — check TLS_CERT_PATH and TLS_KEY_PATH");

    let addr = "0.0.0.0:443".parse().unwrap();
    tracing::info!("TLS enabled — listening on https://{}", addr);
    axum_server::bind_rustls(addr, config)
        .serve(app.into_make_service())
        .await
        .unwrap();
}
```

Note: `axum_server::bind` and `axum_server::bind_rustls` both take `app.into_make_service()`
rather than the `axum::serve(listener, app)` pattern. Remove the `TcpListener` import
and `axum::serve` call entirely — `axum-server` replaces both code paths.

---

## `.env` Updates

### Local homelab `.env`

Add `SKIP_TLS=true` to the local `.env`. `TLS_CERT_PATH` and `TLS_KEY_PATH` are not
required when `SKIP_TLS=true` — do not add them.

```env
SKIP_TLS=true
# TLS_CERT_PATH and TLS_KEY_PATH not needed for local dev
```

### `.env.example`

Document all three new variables:

```env
# TLS configuration
# Set SKIP_TLS=true for local development without certificates
# Default behavior (unset or false) enables TLS on port 443
SKIP_TLS=false
TLS_CERT_PATH=/certs/origin.pem
TLS_KEY_PATH=/certs/origin.key
```

---

## `docker/docker-compose.prod.yml` Updates

Add the three TLS env vars to the `api` service. The certs bind mount should already
be present from the earlier step — confirm it is:

```yaml
  api:
    image: loontechcraig/borealis-api:latest
    restart: unless-stopped
    depends_on:
      - postgres
    ports:
      - "443:443"
    volumes:
      - /opt/borealis/certs:/certs:ro
    environment:
      DATABASE_URL: postgresql://borealis:${POSTGRES_PASSWORD}@postgres:5432/borealis
      SKIP_TLS: "false"
      TLS_CERT_PATH: /certs/origin.pem
      TLS_KEY_PATH: /certs/origin.key
```

The port mapping remains `443:443`. The certs volume mounts the host path
`/opt/borealis/certs` (where the Cloudflare Origin Certificate lives on the EC2
instance) to `/certs` inside the container, read-only.

---

## EC2 Bootstrap — Placing the Certificates

After the code changes are complete and a new image is pushed to Docker Hub, place
the Cloudflare Origin Certificate on the EC2 instance before starting the stack.

**From your local machine**, copy the cert and key to the instance via Tailscale SSH:

```bash
scp origin.pem admin@borealis:/opt/borealis/certs/origin.pem
scp origin.key admin@borealis:/opt/borealis/certs/origin.key
```

**On the instance**, verify the files are in place and permissions are correct:

```bash
ssh admin@borealis
ls -la /opt/borealis/certs/
# Should show origin.pem and origin.key
# Restrict key permissions
chmod 600 /opt/borealis/certs/origin.key
chmod 644 /opt/borealis/certs/origin.pem
```

---

## EC2 Bootstrap — `.env` and Compose

**On the instance**, create the production `.env`:

```bash
cd /opt/borealis
cp .env.example .env
nano .env   # or vim, editor of your choice
```

Fill in all values:

```env
POSTGRES_PASSWORD=<strong-random-password>
USER_AGENT=borealis/1.0
KP_URL=https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json
BZ_URL=https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json
WIND_URL=https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json
SKIP_TLS=false
TLS_CERT_PATH=/certs/origin.pem
TLS_KEY_PATH=/certs/origin.key
```

**Copy the prod compose file** to the instance (from your local machine):

```bash
scp docker/docker-compose.prod.yml admin@borealis:/opt/borealis/docker-compose.yml
```

---

## Starting the Stack

**On the instance:**

```bash
cd /opt/borealis

# Pull the latest images from Docker Hub
docker compose pull

# Start all services in the background
docker compose up -d

# Verify all three containers are running
docker compose ps

# Tail logs to confirm clean startup
docker compose logs -f
```

Expected log output from `borealis-api` on clean TLS startup:
```
INFO borealis_api: TLS enabled — listening on https://0.0.0.0:443
```

Expected log output from `borealis-collector`:
```
INFO borealis_collector: starting polling loop
```

---

## Verification

### Local (SKIP_TLS=true)

```bash
# Confirm plain HTTP still works
cargo run -p borealis-api
curl http://localhost:3000/api/latest
# → JSON response
```

### Production

```bash
# From your local machine — confirm HTTPS via Cloudflare
curl https://borealis.loontechnology.com/api/latest
# → JSON response

# Confirm direct origin access is blocked (should time out or be refused)
curl https://<eip-address>/api/latest
# → connection refused or timeout — this is correct behavior

# Browser check
# Open https://borealis.loontechnology.com in a browser
# Padlock should show — certificate issued by Cloudflare
# Dashboard should load and charts should populate
```

### Certificate validation

```bash
# Confirm the certificate Cloudflare is presenting to browsers
# (This checks Cloudflare's edge cert, not your origin cert)
curl -vI https://borealis.loontechnology.com 2>&1 | grep -A5 "Server certificate"
```

### Container health on the instance

```bash
ssh admin@borealis
cd /opt/borealis

docker compose ps
# All three services: Status = running

docker compose logs api --tail=50
# No TLS errors, listening on 443

docker compose logs collector --tail=50
# Polling loop running, inserts succeeding
```

---

## Cargo workspace changes summary

| File | Change |
|------|--------|
| `Cargo.toml` (root) | Add `axum-server` to `[workspace.dependencies]` |
| `crates/borealis-api/Cargo.toml` | Add `axum-server = { workspace = true }` |
| `crates/borealis-api/src/main.rs` | Replace `TcpListener`/`axum::serve` with conditional `axum_server` dispatch |
| `.env` (local) | Add `SKIP_TLS=true` |
| `.env.example` | Document `SKIP_TLS`, `TLS_CERT_PATH`, `TLS_KEY_PATH` |
| `docker/docker-compose.prod.yml` | Add TLS env vars to `api` service |

---

## What Is NOT Changing in This Step

- No route changes — all API endpoints and ServeDir unchanged
- No frontend changes
- No Terraform changes
- No CI/release workflow changes — the existing release workflow builds and pushes
  the updated image automatically on merge to main
- `borealis-collector` and `borealis-db` — not touched
