#!/usr/bin/env bash
# Manual deploy on VPS (same steps as GitHub Actions).
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$DEPLOY_PATH"

git fetch origin master
git reset --hard origin/master
docker compose pull --ignore-buildable 2>/dev/null || true
docker compose up -d --build --remove-orphans
docker compose ps
