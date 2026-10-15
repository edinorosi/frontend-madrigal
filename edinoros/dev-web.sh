#!/usr/bin/env bash
# Обёртка: веб-версия (бэкенд :8080 + фронтенд :3000).
set -euo pipefail
cd "$(dirname "$0")"
docker compose up -d
echo "Открыть: http://localhost:3000 (API: http://localhost:8080)"
