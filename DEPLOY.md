# Deploying SinoutX to a server

## Requirements
- Ubuntu/Debian server with Docker and Docker Compose
- Nginx Proxy Manager (already running)
- A domain pointed at the server's IP (e.g. `sinout.dasp.top` for the
  landing page and `app.sinout.dasp.top` for the app)

---

## 1. Clone the repository

Create a Personal Access Token on GitHub:
**Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**
Select the `repo` scope → copy the token.

```bash
git clone https://YOUR_TOKEN@github.com/iezhik87/sinoutX.git /media/mediassd/sinout
cd /media/mediassd/sinout
chmod +x deploy.sh
```

> The token is entered once at clone time. `git pull` inside `deploy.sh`
> reuses it from the saved repo URL.

---

## 2. Create .env

```bash
cp .env.example .env
nano .env
```

Fill in every value:

```env
# PostgreSQL
DB_USER=sinout
DB_PASSWORD=CHOOSE_A_STRONG_PASSWORD

# Redis
REDIS_PASSWORD=CHOOSE_A_STRONG_PASSWORD

# Meilisearch
MEILI_KEY=CHOOSE_A_KEY_MIN_16_CHARS

# MinIO
MINIO_USER=sinout
MINIO_PASSWORD=CHOOSE_A_STRONG_PASSWORD

# JWT (min 32 chars)
JWT_SECRET=CHOOSE_A_LONG_RANDOM_KEY_MIN_32_CHARS

# Encryption key for secrets at rest (AI provider keys, integration tokens).
# Recommended for cloud/multi-tenant. Min 16 chars. openssl rand -base64 32
ENCRYPTION_KEY=CHOOSE_A_RANDOM_KEY_MIN_16_CHARS

# MCP Server
MCP_API_KEY=CHOOSE_A_KEY

# CORS and app URL
CORS_ORIGIN=https://app.sinout.dasp.top
APP_URL=https://app.sinout.dasp.top

# SearXNG (can be left as-is)
SEARXNG_SECRET=sinout_searxng_secret_key_2024

# Optional default AI key — users bring their own (BYOK) in Settings
# ANTHROPIC_API_KEY=sk-ant-...

# Optional: in-app crypto billing (NOWPayments)
# NOWPAYMENTS_API_KEY=your_api_key
# NOWPAYMENTS_IPN_SECRET=your_ipn_secret
# PRICE_TEAM_USD=149

# SMTP for password reset / emails (optional)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your@gmail.com
# SMTP_PASS=your_app_password
# SMTP_FROM=SinoutX <your@gmail.com>
```

> **Password tip:** use a generator, e.g.:
> ```bash
> openssl rand -base64 32
> ```

---

## 3. Start the stack

```bash
cd /media/mediassd/sinout
docker compose up -d
```

The first run takes 3–5 minutes — images are pulled, backend and
frontend are built, and DB migrations are applied.

Check that everything started:
```bash
docker compose ps
```

All services should be `running` or `healthy`. Check health:
```bash
curl http://localhost:8090/health
```

Expected response:
```json
{"status":"ok","services":{"database":"ok","meilisearch":"ok","redis":"ok"}}
```

---

## 4. Configure Nginx Proxy Manager

The stack exposes two ports on the host:
- **8090** — the app (React SPA + API)
- **8091** — the marketing landing page

Create two Proxy Hosts in NPM (usually at `http://IP:81`):

### Landing → `sinout.dasp.top`
- **Domain Names:** `sinout.dasp.top`
- **Scheme:** `http`
- **Forward Hostname / IP:** `127.0.0.1`
- **Forward Port:** `8091`
- **SSL:** Request a new certificate, Force SSL ✓, HTTP/2 ✓

### App → `app.sinout.dasp.top`
- **Domain Names:** `app.sinout.dasp.top`
- **Scheme:** `http`
- **Forward Hostname / IP:** `127.0.0.1`
- **Forward Port:** `8090`
- **Websockets Support:** ✓ (required — collab server + AI chat SSE)
- **SSL:** Request a new certificate, Force SSL ✓, HTTP/2 ✓

After this the landing is at `https://sinout.dasp.top` and the app at
`https://app.sinout.dasp.top`.

### Landing videos are not in git

`landing/videos/` is gitignored. The clips are re-rendered often, and every
re-upload of a 5 MB file would live in the history forever — that is how this
repo once grew to 95 MB. Ship them separately:

```bash
./scripts/sync-landing-videos.sh user@host:/path/to/sinout
```

nginx serves them straight from disk, so no restart is needed. After a
re-render, bump `VIDEO_V` in `landing/index.html` and `landing/integrations.html`:
the filenames never change, so a cached browser would otherwise splice byte
ranges of the old file into the new one and report that the video is damaged.

---

## 5. First sign-in

Open `https://app.sinout.dasp.top` — the registration page appears.

**The first registered user automatically becomes OWNER** (and is never
limited by plan quotas).

After the first user signs up, go to **Admin → Registration** and pick a
mode:
- **Invite-only** — registration by code only
- **Closed** — nobody can register

---

## 6. Updating later

On the server a single command is enough:

```bash
cd /media/mediassd/sinout && ./deploy.sh
```

The script detects what changed (backend / frontend / config) and
rebuilds only what's needed.

> If a force-pushed history ever makes `git pull` complain about
> divergent branches, run `git reset --hard origin/main` (the server is
> a deploy checkout — it has no local work to lose).

---

## Port layout

| Service | External port | Purpose |
|---------|--------------|---------|
| nginx — app (Docker) | 8090 | App entry point → NPM |
| nginx — landing (Docker) | 8091 | Landing page → NPM |
| Everything else | closed | Docker-internal network only |

---

## Useful commands

```bash
# Follow backend logs
docker logs sinout-backend-1 -f

# Follow all service logs
docker compose logs -f

# Restart a single service
docker compose restart backend

# Stop everything
docker compose down

# Stop and delete data (CAUTION — wipes the database!)
docker compose down -v
```

---

## Backup

Data lives in Docker volumes. You can back up straight from the app:
**Settings → Backup → Download backup**

Or via command line:
```bash
docker run --rm \
  -v sinout_postgres_data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/postgres-$(date +%Y%m%d).tar.gz -C /data .
```
