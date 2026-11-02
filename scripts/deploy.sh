#!/usr/bin/env bash
# Production deploy, run ON the EC2 box by .github/workflows/deploy.yml (over SSH through AWS
# Session Manager). The workflow first pushes the commit into this repo as refs/deploy/next, so the
# server never needs GitHub access. By hand, from a checkout with `ssh kynq-prod` set up:
#   git push kynq-prod:kynq-backend HEAD:refs/deploy/next --force
#   ssh kynq-prod "DEPLOY_SHA=$(git rev-parse HEAD) APP_DIR=\$HOME/kynq-backend PM2_APP=kynq-backend bash -s" < scripts/deploy.sh
#
#   1. check out DEPLOY_SHA (tracked files only: .env, node_modules and other ignored files stay)
#   2. npm ci, only when package-lock.json changed
#   3. pm2 reload with GIT_COMMIT set, so /api/health reports what's running
#   4. wait for /api/health to say ok AND report the new commit
#   5. anything fails → back to the previous commit, reinstall if needed, reload
set -Eeuo pipefail

APP_DIR="${APP_DIR:?set APP_DIR to the backend checkout on the server}"
DEPLOY_SHA="${DEPLOY_SHA:?set DEPLOY_SHA to the commit to deploy (pushed as refs/deploy/next)}"
PM2_APP="${PM2_APP:-all}"
PORT="${PORT:-3001}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/api/health}"
HEALTH_TRIES="${HEALTH_TRIES:-30}" # × 2s

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

cd "$APP_DIR"
# Empty on the very first deploy (the files were copied in before this repo had commits).
PREV="$(git rev-parse -q --verify HEAD || true)"
NEXT="$(git rev-parse --verify "${DEPLOY_SHA}^{commit}")"
if [ "$PREV" = "$NEXT" ]; then log "already on ${NEXT:0:7}, nothing to do"; exit 0; fi
log "deploying ${PREV:0:7}${PREV:+ }→ ${NEXT:0:7}"

install_if_needed() { # $1 = commit we came from (empty: first deploy)
  if [ -z "$1" ]; then
    [ -d node_modules ] && return 0 # first deploy over an installed copy
  elif git diff --quiet "$1" HEAD -- package-lock.json package.json; then
    return 0
  fi
  log "dependencies changed, running npm ci"
  npm ci --omit=dev --no-audit --no-fund
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
  if [ -z "$PREV" ]; then log "FAILED on the first deploy, nothing to roll back to — check pm2 logs now"; exit 1; fi
  log "ROLLING BACK to ${PREV:0:7}"
  git reset --quiet --hard "$PREV"
  install_if_needed "$NEXT"
  reload
  if healthy "$(git rev-parse --short HEAD)"; then log "rolled back, ${PREV:0:7} is serving"; else log "rollback is NOT healthy either — check pm2 logs now"; fi
  exit 1
}
trap rollback ERR

git reset --quiet --hard "$NEXT"
install_if_needed "$PREV"
reload
trap - ERR
healthy "$(git rev-parse --short HEAD)" || rollback
log "live: ${NEXT:0:7}"
