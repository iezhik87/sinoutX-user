#!/usr/bin/env bash
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SinoutX — initial setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Check dependencies
command -v docker >/dev/null 2>&1 || { echo "Error: Docker is not installed."; exit 1; }
command -v docker compose >/dev/null 2>&1 || { echo "Error: Docker Compose is not installed."; exit 1; }

# 2. Copy .env if it does not exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✓ Created .env from .env.example — fill in the values!"
  echo "  Open .env and replace every 'changeme_*' with a real value."
  exit 1
fi

# 3. Make sure .env has no placeholders left
if grep -q "changeme" .env; then
  echo "⚠  Placeholder values detected in .env!"
  echo "   Replace every 'changeme_*' before starting."
  exit 1
fi

# 4. Start infrastructure only (DB + cache + search + storage)
echo ""
echo "→ Starting PostgreSQL, Redis, Meilisearch, MinIO..."
docker compose up -d postgres redis meilisearch minio

# 5. Wait for PostgreSQL to be ready
echo "→ Waiting for PostgreSQL..."
until docker compose exec postgres pg_isready -U "${DB_USER:-sinout}" >/dev/null 2>&1; do
  sleep 1
done
echo "✓ PostgreSQL is ready"

# 6. Run migrations
echo "→ Applying Prisma migrations..."
docker compose run --rm backend sh -c "npx prisma migrate deploy"
echo "✓ Migrations applied"

# 7. Start everything
echo "→ Starting all services..."
docker compose up -d

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SinoutX is running!"
echo ""
echo "  Frontend:    http://localhost:3012"
echo "  API:         http://localhost:3010"
echo "  API Docs:    http://localhost:3010/docs"
echo "  MCP Server:  http://localhost:3011"
echo "  MinIO UI:    http://localhost:9001"
echo "  Meilisearch: http://localhost:7700"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
