#!/usr/bin/env bash
# Обёртка: сборка Linux Tauri-инсталлятора (.deb/.AppImage) в контейнере.
set -euo pipefail
cd "$(dirname "$0")"
docker compose --profile tauri-build up --build tauri-build
echo "Артефакты: src-tauri/target/release/bundle/"
