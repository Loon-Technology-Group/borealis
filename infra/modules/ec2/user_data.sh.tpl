#!/bin/bash
set -euo pipefail

# ── System update ─────────────────────────────────────────────────────────────
apt-get update
apt-get upgrade -y

# ── Docker ────────────────────────────────────────────────────────────────────
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl enable docker
systemctl start docker

# ── Tailscale ─────────────────────────────────────────────────────────────────
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey="${tailscale_auth_key}" --ssh

# ── Application directory structure ───────────────────────────────────────────
mkdir -p /opt/borealis/certs

# Placeholder .env — operator must fill this in before starting the stack
cat > /opt/borealis/.env.example <<'EOF'
POSTGRES_PASSWORD=
USER_AGENT=borealis/1.0
KP_URL=https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json
BZ_URL=https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json
WIND_URL=https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json
EOF

echo "Bootstrap complete. Next steps:"
echo "  1. Copy docker-compose.prod.yml to /opt/borealis/docker-compose.yml"
echo "  3. Place Cloudflare Origin Cert at /opt/borealis/certs/origin.pem"
echo "  4. Place Cloudflare Origin Key at /opt/borealis/certs/origin.key"
echo "  5. Create /opt/borealis/.env from .env.example"
echo "  6. Run: cd /opt/borealis && docker compose pull && docker compose up -d"
