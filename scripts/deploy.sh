#!/usr/bin/env bash
# Production deploy, run ON the EC2 box by .github/workflows/deploy.yml (over SSH).
# Can also be run by hand:  APP_DIR=~/kynq-backend PM2_APP=all bash scripts/deploy.sh
#
#   1. fast-forward to origin/main (refuses if the server has diverged — never force)
#   2. npm ci, only when package-lock.json changed
#   3. pm2 reload with GIT_COMMIT set, so /api/health reports what's running
#   4. wait for /api/health to say ok AND report the new commit
#   5. anything fails → back to the previous commit, reinstall if needed, reload
set -Eeuo pipefail

APP_DIR="${APP_DIR:?set APP_DIR to the backend checkout on the server}"
PM2_APP="${PM2_APP:-all}"
PORT="${PORT:-3001}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"
HEALTH_TRIES="${HEALTH_TRIES:-30}" # × 2s

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

cd "$APP_DIR"
PREV="$(git rev-parse HEAD)"
git fetch --quiet origin main
NEXT="$(git rev-parse origin/main)"
if [ "$PREV" = "$NEXT" ]; then log "already on ${NEXT:0:7}, nothing to do"; exit 0; fi
log "deploying ${PREV:0:7} → ${NEXT:0:7}"

install_if_needed() { # $1 = commit we came from
  if ! git diff --quiet "$1" HEAD -- package-lock.json package.json; then
    log "dependencies changed, running npm ci"
    npm ci --omit=dev --no-audit --no-fund
  fi
}

reload() {
  GIT_COMMIT="$(git rev-parse --short HEAD)" pm2 reload "$PM2_APP" --update-env >/dev/null
  pm2 save >/dev/null 2>&1 || true
}

healthy() { # $1 = short commit expected in the health payload
  local body
  for _ in $(seq 1 "$HEALTH_TRIES"); do
    body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null || true)"
    if [[ "$body" == *'"status":"ok"'* && "$body" == *"\"commit\":\"$1\""* ]]; then return 0; fi
    sleep 2
  done
  log "health check failed, last response: ${body:-<none>}"
  return 1
}

rollback() {
  trap - ERR
  set +e
  log "ROLLING BACK to ${PREV:0:7}"
  git reset --quiet --hard "$PREV"
  install_if_needed "$NEXT"
  reload
  if healthy "$(git rev-parse --short HEAD)"; then log "rolled back, ${PREV:0:7} is serving"; else log "rollback is NOT healthy either — check pm2 logs now"; fi
  exit 1
}
trap rollback ERR

git merge --ff-only --quiet origin/main
install_if_needed "$PREV"
reload
trap - ERR
healthy "$(git rev-parse --short HEAD)" || rollback
log "live: ${NEXT:0:7}"
