# Borealis

Borealis collects real-time solar wind and geomagnetic data from NOAA's Space Weather Prediction Center (SWPC) and exposes it via a REST API and web dashboard.

Three data streams are collected every 60 seconds:

- **Kp index** — planetary geomagnetic activity index
- **Solar wind magnetic field (Bz)** — interplanetary magnetic field components
- **Solar wind plasma** — density, speed, and temperature

## Requirements

- Docker and Docker Compose
- An ARM64 (aarch64) host — the published images target `linux/arm64`

## Deployment

### 1. Create a compose file

Create a `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: borealis
      POSTGRES_USER: borealis
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

  collector:
    image: loontechcraig/borealis-collector:latest
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://borealis:${POSTGRES_PASSWORD}@postgres:5432/borealis
      USER_AGENT: borealis/1.0
      KP_URL: https://services.swpc.noaa.gov/json/planetary_k_index_1m.json
      WIND_URL: https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json
      BZ_URL: https://services.swpc.noaa.gov/json/dscovr/dscovr_mag_1s.json

  api:
    image: loontechcraig/borealis-api:latest
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://borealis:${POSTGRES_PASSWORD}@postgres:5432/borealis
      USER_AGENT: borealis/1.0
      SKIP_TLS: true
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

### 2. Configure environment

Create a `.env` file in the same directory:

```
POSTGRES_PASSWORD=your_password_here
```

### 3. Start

```bash
docker compose up -d
```

The dashboard will be available at `http://your-host:3000`.

## HTTPS / TLS

To serve over HTTPS, mount your certificate and key into the `api` container and remove `SKIP_TLS`:

```yaml
  api:
    image: loontechcraig/borealis-api:latest
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgresql://borealis:${POSTGRES_PASSWORD}@postgres:5432/borealis
      USER_AGENT: borealis/1.0
      TLS_CERT_PATH: /certs/origin.pem
      TLS_KEY_PATH: /certs/origin.key
    ports:
      - "443:443"
    volumes:
      - /path/to/your/certs:/certs:ro
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/kp` | Kp index readings |
| `GET /api/bz` | Solar wind magnetic field readings |
| `GET /api/wind` | Solar wind plasma readings |
| `GET /api/latest` | Most recent reading from all three streams |

All list endpoints accept an optional `?window=` query parameter: `1h`, `3h`, `6h`, `12h`, `24h`.
