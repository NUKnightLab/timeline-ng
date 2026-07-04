# ATProto OAuth Local Devnet Setup

How to run a local ATProto PDS with full OAuth write-scope support for browser-based development. This guide covers the constraints, the working solution, and the exact setup used in this repo.

---

## What you get

- A local PDS (Personal Data Server) at `https://devnet.internal`
- Browser ATProto OAuth that grants `transition:generic` write scope (required for `putRecord`)
- Postgres + maildev bundled in the devnet (no separate local DB/SMTP needed)
- Pre-seeded test accounts

---

## Prerequisites

- **Docker + Docker Compose**
- **mkcert** (`brew install mkcert`) — generates a locally-trusted HTTPS cert
- **The Open Social `atproto-devnet` compose stack** cloned at `../../src/atproto-devnet` relative to your project root (or adjust `DEVNET_DIR` in the scripts)
- `/etc/hosts` entry: `127.0.0.1 devnet.internal`

---

## Why this setup is necessary (the constraints)

### Constraint 1: OAuth requires HTTPS

The PDS service endpoint must be HTTPS for browser OAuth to work. A plain HTTP local PDS isn't enough for a production-style OAuth flow.

### Constraint 2: Write scope requires a declared scope

The default ATProto loopback client (`http://localhost?redirect_uri=...`) only grants `atproto` scope, which is read-only identity access. Writing records (e.g. `com.atproto.repo.putRecord`) requires `transition:generic` scope.

### Constraint 3: Discoverable client is blocked by SSRF protection

The natural solution would be a discoverable client: serve `client-metadata.json` at an HTTPS URL declaring `transition:generic` scope, and the PDS fetches it. This fails locally because:

1. `@atproto-labs/fetch-node`'s `unicastFetchWrap` does SSRF protection — it resolves the hostname and rejects RFC 1918 addresses (`'private'` in `ipaddr.js`, not `'unicast'`)
2. Inside Docker, even `devnet.internal` resolves to a Docker bridge IP (172.20.x.x), which is RFC 1918
3. Result: `"Hostname resolved to non-unicast address"` — the PDS refuses to fetch your client metadata

### Constraint 4: TLD must be `.internal`

`@atproto/oauth-types` `isLocalHostname()` blocks `.test`, `.local`, `.localhost`, `.invalid`, and `.example` as invalid OAuth client ID TLDs. `.internal` is not on the blocklist.

### Constraint 5: Redirect URI must use `127.0.0.1`, not `localhost`

RFC 8252 §8.3 and the ATProto `oauthLoopbackClientRedirectUriSchema` explicitly reject `localhost` as a redirect URI hostname. Use `127.0.0.1` (or `[::1]`).

---

## The solution: loopback client ID with scope param

The ATProto spec allows `scope` as a query parameter in the loopback client ID URL. The PDS reads declared scope directly from these URL params — no HTTP fetch needed, SSRF is bypassed entirely.

```
http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3APORT%2F&scope=atproto%20transition%3Ageneric
```

This is the correct approach for local dev. For production, use a real HTTPS discoverable client (`VITE_ATPROTO_CLIENT_ID=https://your-domain.com/client-metadata.json`).

---

## Project file structure

```
your-project/
├── docker-compose.devnet.yml   # Overlay: wires postgres, maildev, Caddy onto atproto-devnet
├── .env.devnet                 # Port assignments and devnet config (safe to commit)
├── caddy/
│   ├── Caddyfile               # Serves devnet.internal with mkcert cert; proxies to PDS
│   ├── client-metadata.json    # Discoverable client metadata (used if SSRF fix lands)
│   └── certs/                  # mkcert-generated certs (gitignored)
│       ├── devnet.internal.pem
│       └── devnet.internal-key.pem
└── scripts/
    ├── devnet-up.sh            # Auto-generates cert if missing, starts stack
    └── devnet-down.sh          # Stops stack and removes volumes
```

---

## Setup steps

### 1. Add `/etc/hosts` entry

```
127.0.0.1 devnet.internal
```

### 2. Create `docker-compose.devnet.yml`

This overlays on the `atproto-devnet` base compose file:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DEVNET_DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DEVNET_DB_PASSWORD:-postgres}
      POSTGRES_DB: ${DEVNET_DB_NAME:-plc}
    ports:
      - "${DEVNET_POSTGRES_PORT:-5433}:5432"
    networks:
      - atproto-devnet
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DEVNET_DB_USER:-postgres}"]
      interval: 3s
      timeout: 3s
      retries: 10

  maildev:
    image: maildev/maildev:latest
    ports:
      - "${DEVNET_MAILDEV_WEB_PORT:-1081}:1080"
      - "${DEVNET_MAILDEV_SMTP_PORT:-1026}:1025"
    networks:
      - atproto-devnet

  plc:
    depends_on:
      postgres:
        condition: service_healthy

  pds:
    environment:
      PDS_EMAIL_SMTP_URL: smtp://maildev:1025
      NODE_EXTRA_CA_CERTS: /mkcert-ca/rootCA.pem
    volumes:
      - ${MKCERT_CAROOT}:/mkcert-ca:ro

  init:
    volumes:
      - ../../src/atproto-devnet/scripts:/scripts:ro
      - ../../src/atproto-devnet/data:/devnet-data

  caddy:
    image: caddy:2-alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy/client-metadata.json:/srv/client-metadata.json:ro
      - ./caddy/certs/devnet.internal.pem:/certs/devnet.internal.pem:ro
      - ./caddy/certs/devnet.internal-key.pem:/certs/devnet.internal-key.pem:ro
      - caddy-data:/data
    networks:
      atproto-devnet:
        aliases:
          - devnet.internal
    depends_on:
      pds:
        condition: service_healthy

volumes:
  caddy-data:
```

The `NODE_EXTRA_CA_CERTS` line is critical: it lets the PDS trust the mkcert root CA so it can make HTTPS requests to `devnet.internal` for things like DID document resolution.

### 3. Create `caddy/Caddyfile`

```
devnet.internal {
  tls /certs/devnet.internal.pem /certs/devnet.internal-key.pem

  route /client-metadata.json {
    header Content-Type application/json
    header Access-Control-Allow-Origin *
    file_server { root /srv }
  }

  route {
    reverse_proxy http://pds:3000
  }
}

:80 {
  route /client-metadata.json {
    header Content-Type application/json
    header Access-Control-Allow-Origin *
    file_server { root /srv }
  }
  route { reverse_proxy http://pds:3000 }
}
```

### 4. Create `caddy/client-metadata.json`

Update `redirect_uris` to match your dev server port:

```json
{
  "client_id": "https://devnet.internal/client-metadata.json",
  "client_name": "My App (devnet)",
  "redirect_uris": ["http://127.0.0.1:5173/"],
  "scope": "atproto transition:generic",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "application_type": "native",
  "dpop_bound_access_tokens": true
}
```

This file exists but is not used by the loopback OAuth path. It's here for if/when the SSRF constraint is lifted (or if you expose the PDS publicly).

### 5. Create `.env.devnet`

```bash
DEVNET_DB_USER=postgres
DEVNET_DB_PASSWORD=postgres
DEVNET_DB_NAME=plc
DEVNET_POSTGRES_PORT=5433
DEVNET_PDS_PORT=3000
DEVNET_PLC_PORT=2582
DEVNET_PDS_HOSTNAME=devnet.internal
DEVNET_MAILDEV_WEB_PORT=1081
DEVNET_MAILDEV_SMTP_PORT=1026
# Set this to your mkcert CA root directory:
# macOS: /Users/YOU/Library/Application Support/mkcert
# Linux: ~/.local/share/mkcert
# Run `mkcert -CAROOT` to find it
MKCERT_CAROOT=/Users/YOU/Library/Application Support/mkcert
```

### 6. Create startup scripts

**`scripts/devnet-up.sh`:**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEVNET_DIR="$PROJECT_DIR/../../src/atproto-devnet"  # adjust to your clone location
cd "$PROJECT_DIR"

if ! command -v mkcert &>/dev/null; then
  echo "Error: mkcert not found. Install: brew install mkcert" >&2; exit 1
fi
mkcert -install || true

CERT_DIR="$PROJECT_DIR/caddy/certs"
if [ ! -f "$CERT_DIR/devnet.internal.pem" ] || [ ! -f "$CERT_DIR/devnet.internal-key.pem" ]; then
  echo "Generating mkcert certificate for devnet.internal..."
  mkdir -p "$CERT_DIR"
  mkcert -cert-file "$CERT_DIR/devnet.internal.pem" -key-file "$CERT_DIR/devnet.internal-key.pem" devnet.internal
fi

docker compose \
  -f "$DEVNET_DIR/docker-compose.yml" \
  -f docker-compose.devnet.yml \
  --env-file .env.devnet \
  --project-directory . \
  up -d --wait
```

**`scripts/devnet-down.sh`:**

```bash
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
```

### 7. Gitignore the certs

Add to `.gitignore`:

```
caddy/certs/
```

---

## Browser client code

Install: `npm install @atproto/oauth-client-browser @atproto/api`

Set these env vars for your Vite/webpack app (adapt for your framework):

```bash
# .env.local (when running against devnet)
VITE_ATPROTO_PLC_URL=http://localhost:2582
VITE_ATPROTO_HANDLE_RESOLVER=https://devnet.internal
VITE_ATPROTO_ALLOW_HTTP=true
# Leave VITE_ATPROTO_CLIENT_ID unset — falls through to loopback with write scope
```

The OAuth client setup:

```typescript
import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

const CLIENT_ID_ENV = import.meta.env.VITE_ATPROTO_CLIENT_ID as string | undefined;

// Loopback client ID encoding write scope in URL params.
// ATProto spec allows `scope` as a query param; PDS reads it directly — no HTTP fetch,
// no SSRF. redirect_uri must use 127.0.0.1, not localhost (RFC 8252 §8.3).
function buildWriteLoopbackClientId(location: Location): string {
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname;
  const port = location.port ? `:${location.port}` : '';
  const redirectUri = `http://${host}${port}/`;
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('atproto transition:generic')}`;
}

let _client: BrowserOAuthClient | null = null;

async function client(): Promise<BrowserOAuthClient> {
  if (_client) return _client;
  _client = await BrowserOAuthClient.load({
    clientId: CLIENT_ID_ENV ?? buildWriteLoopbackClientId(window.location),
    handleResolver: import.meta.env.VITE_ATPROTO_HANDLE_RESOLVER ?? 'https://bsky.social',
    plcDirectoryUrl: import.meta.env.VITE_ATPROTO_PLC_URL,
    allowHttp: import.meta.env.VITE_ATPROTO_ALLOW_HTTP === 'true',
  });
  return _client;
}
```

For production, set `VITE_ATPROTO_CLIENT_ID=https://your-domain.com/client-metadata.json`. The loopback path is only used when the env var is unset.

---

## Seeded accounts

The `atproto-devnet` init container seeds accounts defined in `src/atproto-devnet/data/accounts.json`. Typical defaults from that project: `alice.devnet.test` / `alice-devnet-pass`, `bob.devnet.test` / `bob-devnet-pass`.

When signing in through the browser OAuth flow, use the handle (e.g. `alice.devnet.test`).

---

## Endpoints

| Service | URL |
|---|---|
| PDS (HTTPS, for OAuth) | `https://devnet.internal` |
| PDS (HTTP direct) | `http://localhost:3000` |
| PLC directory | `http://localhost:2582` |
| MailDev web UI | `http://localhost:1081` |
| Postgres | `localhost:5433` |

---

## Teardown and reset

`devnet-down.sh` stops everything and removes Docker volumes (including the PDS database).

After a down+up cycle, the init container skips re-seeding if `src/atproto-devnet/data/accounts.json` already exists but the PDS DB is empty. To force re-seeding:

```bash
rm src/atproto-devnet/data/accounts.json
# Then restart just the init container:
docker compose ... restart init
```

To reset a stuck OAuth session in the browser: `localStorage.clear()` in the devtools console, then reload.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in does nothing, no visible error | `redirect_uri` uses `localhost` hostname | Use `127.0.0.1` in redirect URI (RFC 8252) |
| `isLocalHostname` error | TLD is `.test`, `.local`, etc. | Use `.internal` |
| `Hostname resolved to non-unicast address` | PDS SSRF protection blocks Docker IPs | Use loopback client ID (not discoverable client) |
| `putRecord` scope error | Loopback client has `atproto` scope only | Encode `scope=atproto transition:generic` in client ID URL |
| PDS can't resolve `devnet.internal` | mkcert CA not trusted by Node | Set `NODE_EXTRA_CA_CERTS` to mkcert CA root in PDS container |
| Seeded accounts missing after restart | init container skipped seeding | Delete `accounts.json`, restart init container |
