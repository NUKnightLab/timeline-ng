#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEVNET_DIR="$PROJECT_DIR/../../src/atproto-devnet"

cd "$PROJECT_DIR"

# ── mkcert setup ─────────────────────────────────────────────────────────────
if ! command -v mkcert &>/dev/null; then
  echo "Error: mkcert not found. Install it with: brew install mkcert" >&2
  exit 1
fi

# Ensure mkcert root CA is installed (idempotent; ignore non-fatal Firefox profile errors)
mkcert -install || true

CERT_DIR="$PROJECT_DIR/caddy/certs"
CERT_PEM="$CERT_DIR/devnet.internal.pem"
CERT_KEY="$CERT_DIR/devnet.internal-key.pem"

if [ ! -f "$CERT_PEM" ] || [ ! -f "$CERT_KEY" ]; then
  echo "Generating mkcert certificate for devnet.internal..."
  mkdir -p "$CERT_DIR"
  mkcert -cert-file "$CERT_PEM" -key-file "$CERT_KEY" devnet.internal
fi

# ── Start stack ───────────────────────────────────────────────────────────────
echo "Starting atproto devnet..."
docker compose \
  -f "$DEVNET_DIR/docker-compose.yml" \
  -f docker-compose.devnet.yml \
  --env-file .env.devnet \
  --project-directory . \
  up -d --wait

echo ""
echo "Devnet is up:"
echo "  PDS (direct): http://localhost:$(grep DEVNET_PDS_PORT .env.devnet | cut -d= -f2)"
echo "  PDS (HTTPS):  https://devnet.internal"
echo "  PLC:          http://localhost:$(grep DEVNET_PLC_PORT .env.devnet | cut -d= -f2)"
echo "  MailDev:      http://localhost:$(grep DEVNET_MAILDEV_WEB_PORT .env.devnet | cut -d= -f2)"
echo ""

# Show seeded accounts if available
ACCOUNTS_FILE="$DEVNET_DIR/data/accounts.json"
if [ -f "$ACCOUNTS_FILE" ]; then
  echo "Seeded accounts (from $ACCOUNTS_FILE):"
  cat "$ACCOUNTS_FILE"
  echo ""
fi
