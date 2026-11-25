#!/usr/bin/env bash
# Explicit opt-in only. Never called by deploy.sh; does not touch SEARCH_API.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-fallback}"
case "$MODE" in
  fallback|primary) ;;
  *) echo "Usage: bash scripts/enable-browser-search.sh [fallback|primary]"; exit 1 ;;
esac
command -v python3 >/dev/null || { echo "python3 is required to update .env safely"; exit 1; }
docker compose version >/dev/null
python3 - "$MODE" <<'PY'
import os
from pathlib import Path
import re
import secrets
import shlex
import stat
import sys
import tempfile

p = Path('.env')
if not p.is_file():
    raise SystemExit('Create and configure .env before enabling browser search')
text = p.read_text(encoding='utf-8')
matches = re.findall(r'^(?:export\s+)?BROWSER_SEARCH_TOKEN=(.*)$', text, re.M)
parts = shlex.split(matches[-1], comments=True) if matches else []
updates = {'BROWSER_SEARCH_MODE': sys.argv[1]}
if not parts or not parts[0]:
    updates['BROWSER_SEARCH_TOKEN'] = secrets.token_hex(32)
# Keep an existing token line verbatim, including its dotenv quoting/comments.
for key, value in updates.items():
    pattern = r'^(?:export\s+)?' + key + r'=[^\r\n]*$'
    if re.search(pattern, text, re.M):
        text = re.sub(pattern, lambda _: key + '=' + value, text, flags=re.M)
    else:
        text = text.rstrip('\n') + '\n' + key + '=' + value + '\n'
with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir='.', prefix='.env.browser-search-', delete=False) as out:
    temp = out.name
    out.write(text)
try:
    os.chmod(temp, stat.S_IMODE(p.stat().st_mode))
    os.replace(temp, p)
finally:
    if os.path.exists(temp):
        os.unlink(temp)
print('Browser search mode: ' + sys.argv[1] + '; shared token prepared (not displayed).')
PY
docker compose --profile browser-search build browser-search backend
docker compose --profile browser-search up -d --no-deps browser-search backend
# Backend has a new container IP; refresh the proxy's upstream resolution.
docker compose up -d --no-deps --force-recreate nginx
echo 'Started. Verify with: bash scripts/search-doctor.sh --browser-only "погода Минск"'
