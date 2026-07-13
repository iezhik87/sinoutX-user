#!/bin/bash
set -e

cd "$(dirname "$0")"

# Commit that was actually deployed last time (not just the previous pull).
# Lets us detect everything changed since the last successful deploy, even if
# code was pulled in between by another command (e.g. migrate-storage.sh).
PREV_DEPLOYED=$(cat .last-deploy 2>/dev/null || true)

echo "==> Pulling latest code..."
git pull

# Record the deployed version so the admin panel can show what's running.
# Persisted into .env so every `docker compose` invocation sees it.
APP_VERSION=$(git rev-parse --short HEAD)
APP_BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "==> Deploy version: $APP_VERSION ($APP_BUILT_AT)"
touch .env
grep -v -E '^(APP_VERSION|APP_BUILT_AT)=' .env > .env.tmp 2>/dev/null || true
mv .env.tmp .env
printf 'APP_VERSION=%s\nAPP_BUILT_AT=%s\n' "$APP_VERSION" "$APP_BUILT_AT" >> .env

# Diff against the last *deployed* commit when we know it AND it is still an
# ancestor of HEAD. Existence alone is not enough: after a history rewrite the
# old SHA lingers in the object store but describes a tree from a dead branch,
# so diffing against it reports phantom changes (or none) until gc drops it.
if [ -n "$PREV_DEPLOYED" ] \
  && git cat-file -e "${PREV_DEPLOYED}^{commit}" 2>/dev/null \
  && git merge-base --is-ancestor "$PREV_DEPLOYED" HEAD 2>/dev/null; then
  echo "==> Comparing against last deployed commit: $PREV_DEPLOYED"
  CHANGED=$(git diff "$PREV_DEPLOYED" HEAD --name-only)
else
  if [ -n "$PREV_DEPLOYED" ]; then
    echo "==> $PREV_DEPLOYED is not an ancestor of HEAD (history rewritten?) — rebuilding everything"
    CHANGED=$(git ls-files)
  else
    CHANGED=$(git diff HEAD@{1} HEAD --name-only 2>/dev/null || git diff HEAD~1 HEAD --name-only)
  fi
fi

BACKEND_CHANGED=false
FRONTEND_CHANGED=false
MCP_CHANGED=false
COLLAB_CHANGED=false
COMPOSE_CHANGED=false

echo "$CHANGED" | grep -q "^packages/backend/" && BACKEND_CHANGED=true
echo "$CHANGED" | grep -q "^packages/frontend/" && FRONTEND_CHANGED=true
echo "$CHANGED" | grep -q "^packages/mcp-server/" && MCP_CHANGED=true
echo "$CHANGED" | grep -q "^packages/collab-server/" && COLLAB_CHANGED=true
echo "$CHANGED" | grep -qE "^docker-compose\.yml|^nginx/" && COMPOSE_CHANGED=true

if [ "$BACKEND_CHANGED" = false ] && [ "$FRONTEND_CHANGED" = false ] && [ "$MCP_CHANGED" = false ] && [ "$COLLAB_CHANGED" = false ] && [ "$COMPOSE_CHANGED" = false ]; then
  echo "==> No relevant changes detected. Done."
  exit 0
fi

if [ "$BACKEND_CHANGED" = true ]; then
  echo "==> Backend changed — rebuilding..."
  docker compose build --no-cache backend
  docker compose up -d --no-deps backend
  echo "==> Waiting for backend to be healthy..."
  for i in $(seq 1 30); do
    if docker compose ps backend | grep -q "healthy"; then
      echo "==> Backend is healthy."
      break
    fi
    sleep 2
  done
fi

if [ "$FRONTEND_CHANGED" = true ]; then
  echo "==> Frontend changed — rebuilding..."
  docker build --no-cache -t sinout-frontend:latest packages/frontend/
  docker compose up -d --no-deps frontend
fi

if [ "$MCP_CHANGED" = true ]; then
  echo "==> MCP server changed — rebuilding..."
  docker compose build mcp-server
  docker compose up -d --no-deps mcp-server
fi

if [ "$COLLAB_CHANGED" = true ]; then
  echo "==> Collab server changed — rebuilding..."
  docker compose build collab-server
  docker compose up -d --no-deps collab-server
fi

if [ "$COMPOSE_CHANGED" = true ]; then
  echo "==> docker-compose.yml or nginx changed — restarting affected services..."
  docker compose up -d
fi

# Always re-apply the backend env so the deploy version updates even when only
# the frontend changed. compose recreates the container only because APP_VERSION
# changed; if it was already rebuilt above this is a no-op.
if [ "$BACKEND_CHANGED" = false ] && [ "$COMPOSE_CHANGED" = false ]; then
  echo "==> Refreshing backend deploy version..."
  docker compose up -d --no-deps backend
  BACKEND_CHANGED=true  # ensure nginx re-resolves the new backend IP below
fi

# Recreating backend/frontend gives the container a new internal IP, but the
# nginx reverse proxy resolves the static `upstream` blocks only once at start —
# so it keeps proxying to the old (now dead) IP and returns 502. Reload nginx so
# it re-resolves the upstreams. (collab/mcp use a resolver var and self-heal.)
if [ "$BACKEND_CHANGED" = true ] || [ "$FRONTEND_CHANGED" = true ]; then
  echo "==> Reloading nginx so it re-resolves backend/frontend IPs..."
  docker compose exec -T nginx nginx -s reload || docker compose restart nginx
fi

# Remember what we just deployed, so the next run diffs from here.
git rev-parse HEAD > .last-deploy

echo ""
echo "==> Deploy complete!"
docker compose ps
