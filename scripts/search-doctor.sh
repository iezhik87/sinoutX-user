#!/bin/bash
# Проверка поиска на БОЕВОМ сервере: кто из движков жив с этого адреса.
# Запускать из корня: bash scripts/search-doctor.sh [--api-only|--browser-only] ["запрос"]
set -e
cd "$(dirname "$0")/.."
API_ONLY=0
BROWSER_ONLY=0
if [ "${1:-}" = "--api-only" ]; then
  API_ONLY=1
  shift
elif [ "${1:-}" = "--browser-only" ]; then
  BROWSER_ONLY=1
  shift
fi
[ -n "${1:-}" ] && export SEARCH_DOCTOR_QUERY="$1"
# Внутри контейнера: оттуда видно searxng по имени и видно тот же интернет,
# что видит бэкенд. С хоста ответ был бы про хост, а болит не там.
docker compose exec -T \
  -e SEARCH_DOCTOR_QUERY="${SEARCH_DOCTOR_QUERY:-}" \
  -e SEARCH_DOCTOR_API_ONLY="$API_ONLY" \
  -e SEARCH_DOCTOR_BROWSER_ONLY="$BROWSER_ONLY" \
  backend node - < scripts/search-doctor.mjs
