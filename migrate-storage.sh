#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Перенос основных данных (Postgres / MinIO / Meilisearch / uploads) с системного
# диска на другой смонтированный диск — для случая, когда системный диск мал.
#
# По умолчанию приложение хранит данные в Docker named volumes (на системном
# диске). Этот скрипт копирует их на указанный путь и прописывает в .env
# переменные *_DATA_DIR / UPLOADS_DIR, которые читает docker-compose.yml.
#
# Использование (один раз, ВМЕСТО ./deploy.sh для этого шага):
#     git pull
#     sudo ./migrate-storage.sh /mnt/bigdisk/sinout
#     # путь можно опустить — тогда берётся дефолт ниже
#
# Скрипт идемпотентен (rsync можно гонять повторно) и НЕ удаляет старые volume.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DATA_ROOT="${1:-/media/mediassd/sinout}"   # куда переносим (можно передать аргументом)
ENV_FILE=".env"

cd "$(dirname "$0")"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }

# suffix именованного volume  →  подпапка в DATA_ROOT  →  имя переменной в .env
declare -A SUBDIR=( [postgres_data]=postgres [meili_data]=meili [minio_data]=minio [uploads]=uploads )
declare -A ENVVAR=( [postgres_data]=POSTGRES_DATA_DIR [meili_data]=MEILI_DATA_DIR [minio_data]=MINIO_DATA_DIR [uploads]=UPLOADS_DIR )
ORDER=(postgres_data meili_data minio_data uploads)

# ─── 0. Префлайт ─────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || { red "Запусти через sudo (нужно копировать datadir Postgres с правами)."; exit 1; }
command -v docker >/dev/null || { red "docker не найден."; exit 1; }
command -v rsync  >/dev/null || { red "rsync не найден (apt install rsync)."; exit 1; }

PARENT="$(dirname "$DATA_ROOT")"
mkdir -p "$DATA_ROOT"
if ! mountpoint -q "$PARENT" && [ "$PARENT" != "/" ]; then
  ylw "ВНИМАНИЕ: $PARENT не выглядит точкой монтирования отдельного диска."
  ylw "Убедись, что целевой диск примонтирован и прописан в /etc/fstab (иначе после ребута данные пропадут)."
fi
AVAIL_GB=$(( $(df -Pk "$DATA_ROOT" | awk 'NR==2{print $4}') / 1024 / 1024 ))
grn "✓ Цель: $DATA_ROOT  (свободно ~${AVAIL_GB} GB)"

# ─── 1. Находим существующие named volume (с учётом префикса проекта) ─────────
find_vol() { docker volume ls -q | grep -E "_${1}\$" | head -n1 || true; }

echo; ylw "Что будет перенесено:"
for s in "${ORDER[@]}"; do
  vol=$(find_vol "$s")
  if [ -z "$vol" ]; then red "  ! volume *_$s не найден — пропущу"; continue; fi
  src=$(docker volume inspect -f '{{ .Mountpoint }}' "$vol")
  size=$(du -sh "$src" 2>/dev/null | awk '{print $1}')
  printf "  %-14s %-26s (%s)  →  %s\n" "$s" "$vol" "${size:-?}" "$DATA_ROOT/${SUBDIR[$s]}"
done

echo; read -r -p "Продолжить? Стек будет остановлен на время копирования. [y/N] " ans
[ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Отмена."; exit 0; }

# ─── 2. Останавливаем стек (без -v, чтобы НЕ трогать volume) ──────────────────
echo; ylw "==> docker compose down..."
docker compose down

# ─── 3. Копируем данные ──────────────────────────────────────────────────────
for s in "${ORDER[@]}"; do
  vol=$(find_vol "$s"); [ -z "$vol" ] && continue
  src=$(docker volume inspect -f '{{ .Mountpoint }}' "$vol")
  dst="$DATA_ROOT/${SUBDIR[$s]}"; mkdir -p "$dst"
  ylw "==> $s: $src/  →  $dst/"
  # -a: права/владельцы/время (КРИТИЧНО для Postgres uid:gid 0700); -H: хардлинки
  rsync -aH --delete --info=progress2 "$src/" "$dst/"
done
grn "✓ Копирование завершено."

# ─── 4. Sanity-check ─────────────────────────────────────────────────────────
if [ ! -f "$DATA_ROOT/postgres/PG_VERSION" ]; then
  red "ПРОВЕРКА НЕ ПРОЙДЕНА: нет $DATA_ROOT/postgres/PG_VERSION. Стек НЕ поднимаю."
  red "Старые volume целы — разберись и перезапусти."
  exit 1
fi
grn "✓ Datadir Postgres на месте (PG_VERSION найден)."

# ─── 5. Прописываем пути в .env (их читает docker-compose.yml) ────────────────
touch "$ENV_FILE"
set_env() {  # KEY VALUE — заменяет существующую строку или добавляет новую
  local key="$1" val="$2"
  grep -v -E "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp" 2>/dev/null || true
  mv "${ENV_FILE}.tmp" "$ENV_FILE"
  printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
}
ylw "==> Прописываю пути в $ENV_FILE..."
for s in "${ORDER[@]}"; do set_env "${ENVVAR[$s]}" "$DATA_ROOT/${SUBDIR[$s]}"; done
grn "✓ .env обновлён."

# ─── 6. Поднимаем стек на новых путях ────────────────────────────────────────
echo; ylw "==> docker compose up -d..."
docker compose up -d

echo; grn "════════════════════════════════════════════════════════════════"
grn " Миграция выполнена. Проверь:"
echo  "   docker compose ps        # все healthy?"
echo  "   df -h $DATA_ROOT          # место растёт здесь"
echo  "   зайди в приложение — данные на месте"
echo
echo  " Когда убедишься, что всё ок, освободи системный диск:"
for s in "${ORDER[@]}"; do vol=$(find_vol "$s"); [ -n "$vol" ] && echo "   docker volume rm $vol"; done
grn "════════════════════════════════════════════════════════════════"
