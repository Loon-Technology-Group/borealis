# syntax=docker/dockerfile:1

# ── Stage 1: cross-compile the binary ────────────────────────────────────────
FROM --platform=linux/amd64 rust:bookworm AS builder

RUN rustup target add aarch64-unknown-linux-gnu

RUN apt-get update && apt-get install -y \
    gcc-aarch64-linux-gnu \
    && rm -rf /var/lib/apt/lists/*

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

WORKDIR /app

ARG CRATE
COPY --from=builder /app/target/aarch64-unknown-linux-gnu/release/${CRATE} /usr/local/bin/app

# frontend/ must be mounted at /app/frontend at runtime for borealis-api (ServeDir)
# borealis-collector has no static file dependency

CMD ["/usr/local/bin/app"]
