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

# Deliberately not `--wait`. The stack includes `init`, a one-shot that seeds
# accounts and exits 0 when it succeeds; `up --wait` counts any container that
# exits as a failure, so a completely healthy devnet reported an error and this
# script died on `set -e`. Wait for the thing that actually matters instead.
docker compose \
  -f "$DEVNET_DIR/docker-compose.yml" \
  -f docker-compose.devnet.yml \
  --env-file .env.devnet \
  --project-directory . \
  up -d

echo -n "Waiting for the PDS to answer through Caddy"
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null https://devnet.internal/xrpc/_health; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done

if ! curl -sf -o /dev/null https://devnet.internal/xrpc/_health; then
  echo ""
  echo "PDS did not become ready. Recent container states:" >&2
  docker compose \
    -f "$DEVNET_DIR/docker-compose.yml" \
    -f docker-compose.devnet.yml \
    --env-file .env.devnet \
    --project-directory . \
    ps --format '  {{.Service}}\t{{.State}}\t{{.Health}}' >&2
  exit 1
fi

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
