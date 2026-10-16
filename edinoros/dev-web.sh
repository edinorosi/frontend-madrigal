#!/usr/bin/env bash
# Обёртка: веб-версия (бэкенд :8080 + фронтенд :3000).
set -euo pipefail
cd "$(dirname "$0")"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
  COMPOSE="podman compose"
elif command -v podman-compose >/dev/null 2>&1; then
  COMPOSE="podman-compose"
else
  echo "Ошибка: ни docker, ни podman-compose не найдены"
  exit 1
fi

$COMPOSE up -d
echo "Открыть: http://localhost:3000 (API: http://localhost:8080)"
