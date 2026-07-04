#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEVNET_DIR="$PROJECT_DIR/../../src/atproto-devnet"

cd "$PROJECT_DIR"

docker compose \
  -f "$DEVNET_DIR/docker-compose.yml" \
  -f docker-compose.devnet.yml \
  --env-file .env.devnet \
  --project-directory . \
  down -v

echo "Devnet stopped and volumes removed."
echo "Note: Caddy CA cert remains in your system keychain. Remove it manually from"
echo "  Keychain Access → System → 'Caddy Local Authority' if no longer needed."
