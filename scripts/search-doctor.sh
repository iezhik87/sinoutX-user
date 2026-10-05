#!/bin/bash
# Проверка поиска на БОЕВОМ сервере: кто из движков жив с этого адреса.
# Запускать из корня проекта: bash scripts/search-doctor.sh ["свой запрос"]
set -e
cd "$(dirname "$0")/.."
[ -n "$1" ] && export SEARCH_DOCTOR_QUERY="$1"
# Внутри контейнера: оттуда видно searxng по имени и видно тот же интернет,
# что видит бэкенд. С хоста ответ был бы про хост, а болит не там.
docker compose exec -T \
  -e SEARCH_DOCTOR_QUERY="${SEARCH_DOCTOR_QUERY:-}" \
  backend node - < scripts/search-doctor.mjs
