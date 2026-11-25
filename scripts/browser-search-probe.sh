#!/bin/bash
# One fixed public query; diagnostic comparison without rebuilding containers.
set -e
cd "$(dirname "$0")/.."
docker compose --profile browser-search exec -T browser-search python3 - "$@" < scripts/browser-search-probe.py
