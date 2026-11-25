#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Moves the bulk data (Postgres / MinIO / Meilisearch / uploads) off the system
# disk onto another mounted disk - for when the system disk is too small.
#
# By default the app keeps its data in Docker named volumes (on the system
# disk). This script copies them to the given path and writes the *_DATA_DIR /
# UPLOADS_DIR variables into .env, which docker-compose.yml reads.
#
# Usage (once, INSTEAD of ./deploy.sh for this step):
#     git pull
#     sudo ./migrate-storage.sh /mnt/bigdisk/sinout
#     # the path may be omitted - the default below is used then
#
# The script is idempotent (rsync may be re-run) and does NOT delete the old volumes.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DATA_ROOT="${1:-/media/mediassd/sinout}"   # destination (may be passed as an argument)
ENV_FILE=".env"

cd "$(dirname "$0")"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }

# named-volume suffix  ->  subfolder in DATA_ROOT  ->  variable name in .env
declare -A SUBDIR=( [postgres_data]=postgres [meili_data]=meili [minio_data]=minio [uploads]=uploads )
declare -A ENVVAR=( [postgres_data]=POSTGRES_DATA_DIR [meili_data]=MEILI_DATA_DIR [minio_data]=MINIO_DATA_DIR [uploads]=UPLOADS_DIR )
ORDER=(postgres_data meili_data minio_data uploads)

# --- 0. Preflight ------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || { red "Run this with sudo - copying the Postgres datadir needs the permissions."; exit 1; }
command -v docker >/dev/null || { red "docker not found."; exit 1; }
command -v rsync  >/dev/null || { red "rsync not found (apt install rsync)."; exit 1; }

PARENT="$(dirname "$DATA_ROOT")"
mkdir -p "$DATA_ROOT"
if ! mountpoint -q "$PARENT" && [ "$PARENT" != "/" ]; then
  ylw "WARNING: $PARENT does not look like the mount point of a separate disk."
  ylw "Make sure the target disk is mounted and listed in /etc/fstab - otherwise the data disappears after a reboot."
fi
AVAIL_GB=$(( $(df -Pk "$DATA_ROOT" | awk 'NR==2{print $4}') / 1024 / 1024 ))
grn "OK Target: $DATA_ROOT  (~${AVAIL_GB} GB free)"

# --- 1. Find the existing named volumes (project prefix included) ------------
find_vol() { docker volume ls -q | grep -E "_${1}\$" | head -n1 || true; }

echo; ylw "What will be moved:"
for s in "${ORDER[@]}"; do
  vol=$(find_vol "$s")
  if [ -z "$vol" ]; then red "  ! volume *_$s not found - skipping"; continue; fi
  src=$(docker volume inspect -f '{{ .Mountpoint }}' "$vol")
  size=$(du -sh "$src" 2>/dev/null | awk '{print $1}')
  printf "  %-14s %-26s (%s)  →  %s\n" "$s" "$vol" "${size:-?}" "$DATA_ROOT/${SUBDIR[$s]}"
done

echo; read -r -p "Continue? The stack will be stopped while copying. [y/N] " ans
[ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Cancelled."; exit 0; }

# --- 2. Stop the stack (without -v, so the volumes are NOT touched) ----------
echo; ylw "==> docker compose down..."
docker compose down

# --- 3. Copy the data --------------------------------------------------------
for s in "${ORDER[@]}"; do
  vol=$(find_vol "$s"); [ -z "$vol" ] && continue
  src=$(docker volume inspect -f '{{ .Mountpoint }}' "$vol")
  dst="$DATA_ROOT/${SUBDIR[$s]}"; mkdir -p "$dst"
  ylw "==> $s: $src/  →  $dst/"
  # -a: permissions/owners/times (CRITICAL for Postgres uid:gid 0700); -H: hardlinks
  rsync -aH --delete --info=progress2 "$src/" "$dst/"
done
grn "OK Copy finished."

# ─── 4. Sanity-check ─────────────────────────────────────────────────────────
if [ ! -f "$DATA_ROOT/postgres/PG_VERSION" ]; then
  red "CHECK FAILED: $DATA_ROOT/postgres/PG_VERSION is missing. NOT starting the stack."
  red "The old volumes are intact - investigate and re-run."
  exit 1
fi
grn "OK Postgres datadir is in place (PG_VERSION found)."

# --- 5. Write the paths into .env (docker-compose.yml reads them) -----------
touch "$ENV_FILE"
set_env() {  # KEY VALUE - replaces an existing line or appends a new one
  local key="$1" val="$2"
  grep -v -E "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp" 2>/dev/null || true
  mv "${ENV_FILE}.tmp" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
}
ylw "==> Writing the paths into $ENV_FILE..."
for s in "${ORDER[@]}"; do set_env "${ENVVAR[$s]}" "$DATA_ROOT/${SUBDIR[$s]}"; done
grn "OK .env updated."

# --- 6. Start the stack on the new paths -------------------------------------
echo; ylw "==> docker compose up -d..."
docker compose up -d

echo; grn "════════════════════════════════════════════════════════════════"
grn " Migration done. Check:"
echo  "   docker compose ps        # everything healthy?"
echo  "   df -h $DATA_ROOT          # this is where space is used now"
echo  "   open the app - the data should all be there"
echo
echo  " Once you are satisfied, reclaim the system disk:"
for s in "${ORDER[@]}"; do vol=$(find_vol "$s"); [ -n "$vol" ] && echo "   docker volume rm $vol"; done
grn "════════════════════════════════════════════════════════════════"
