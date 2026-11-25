# Installing the personal self-hosted edition

This repository is the single-user SinoutX edition. It uses your server and API
keys. The first account owns the instance; further registration is closed.
It has no admin panel, team sharing, cloud billing, marketing server or private
browser laboratory. The optional public-search Chromium service is separate
from that laboratory and is included.

## Requirements

- Linux server with Docker Engine and Docker Compose v2.
- At least 4 GB RAM for the base stack; more for optional Chromium, speech and
  local AI services. Build the images with enough memory available.
- A domain and a reverse proxy with TLS if exposing the app to the internet.

## Install

The repository is public: no GitHub token is needed.

```bash
git clone https://github.com/iezhik87/sinoutX-user.git
cd sinoutX-user
cp .env.example .env
nano .env
```

Keep `SINOUT_EDITION=solo` and `DEPLOYMENT_MODE=self-hosted`. Set your own values
for `DB_PASSWORD`, `REDIS_PASSWORD`, `MEILI_KEY`, `MINIO_PASSWORD`, `JWT_SECRET`,
`ENCRYPTION_KEY`, `MCP_API_KEY` and `SEARXNG_SECRET`; follow the minimum lengths in
`.env.example`. Generate independent random values, for example:

```bash
openssl rand -hex 32
```

Set `APP_URL` and `CORS_ORIGIN` to the address at which you will use the app.
For a local HTTP installation this may be `http://localhost:8090`; for a public
installation use your HTTPS domain, for example `https://notes.example.com`.
Never commit `.env` or put provider keys in commands that will be shared.

Build and start:

```bash
docker compose up -d --build
docker compose ps
curl http://localhost:8090/health
```

The first build/download can take several minutes. Backend startup applies the
database migrations automatically. Open your configured URL, register the first
account and connect your own AI provider in Settings. A second account cannot
register in solo mode. The instance owner is not charged by SinoutX; providers
charge for calls made using your keys.

## Domain and TLS

The app is exposed on **8090**. There is no landing page or port 8091 in this
edition. Point your reverse proxy to the Docker host's port 8090, enable TLS and
WebSocket support, and allow long-lived AI streaming responses. If the proxy
runs in a container, use a reachable host address rather than that container's
own `127.0.0.1`. Keep database, Redis, object storage and other internal services
off public interfaces.

## Search

SearXNG is included in the base stack. Optional Serper is configured using
`SEARCH_API=serper` and `SEARCH_API_KEY` in `.env`. Check from the backend network:

```bash
bash scripts/search-doctor.sh "погода Минск"
# This makes one Serper call and consumes API quota:
bash scripts/search-doctor.sh --api-only "погода Минск"
```

Browser search is an optional fallback, off by default. Enable it explicitly:

```bash
bash scripts/enable-browser-search.sh fallback
docker compose --profile browser-search up -d --no-deps --wait --wait-timeout 90 browser-search
bash scripts/search-doctor.sh --browser-only "погода Минск"
```

The setup script generates a separate internal token and preserves provider
keys. Search may still be blocked by the provider. This service does not solve
CAPTCHAs or share login sessions. Its memory limit is 1 GB; allow extra RAM for
it. Disable browser search by setting `BROWSER_SEARCH_MODE=off` in `.env` and
recreating the backend; the container can be stopped separately.

## Updates and backups

Back up the database and uploaded files before updating. Keep `.env` and the
configured data volumes. Do not reset or delete them as part of an update.

```bash
cd /path/to/sinoutX-user
bash deploy.sh
docker compose ps
curl http://localhost:8090/health
```

`deploy.sh` pulls updates and rebuilds affected services; it does not enable
optional profiles automatically. Migrations run at backend startup. If browser
search is enabled, wait for its healthcheck before running diagnostics.

Logs:

```bash
docker compose logs --tail=80 backend
docker compose logs --tail=80 frontend nginx
docker compose --profile browser-search logs --tail=80 browser-search
```

To rebuild the app manually after pulling:

```bash
git pull
docker compose up -d --build --no-deps --wait --wait-timeout 120 backend frontend
docker compose up -d --no-deps --force-recreate nginx
```

The common core includes the authenticated Code client APIs, model tiers and
the price-limit checks. They do not require enabling the multi-user admin UI.
See [README.md](README.md) for features, API keys, MCP and optional services.
