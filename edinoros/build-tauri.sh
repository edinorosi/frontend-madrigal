#!/usr/bin/env bash
# Сборка Linux Tauri-инсталлятора внутри контейнера (см. Dockerfile.tauri-build).
# Монтируется в контейнер: backend -> /workspace/backend, фронт -> /workspace/frontend.
set -euo pipefail

echo "==> [1/4] Сборка sidecar-бэкенда (release)"
cd /workspace/backend
cargo build --release -p protocol-lab-api --bin protocol-lab-api

TRIPLE="$(uname -m)-unknown-linux-gnu"
mkdir -p /workspace/frontend/src-tauri/binaries
cp /workspace/backend/target/release/protocol-lab-api \
   "/workspace/frontend/src-tauri/binaries/protocol-lab-api-${TRIPLE}"
echo "Sidecar скопирован: src-tauri/binaries/protocol-lab-api-${TRIPLE}"

# tauri.conf.json ссылается на ../../../backend/fixtures (от src-tauri/).
# В контейнере фронт лежит в /workspace/frontend, а ../../../ от него — корень /,
# поэтому подставляем symlink /backend -> /workspace/backend.
ln -sfn /workspace/backend /backend

echo "==> [2/4] Установка зависимостей фронта"
cd /workspace/frontend
npm ci

echo "==> [3/4] npx tauri build (beforeBuildCommand сам соберёт Next.js)"
npx tauri build

echo "==> [4/4] Артефакты"
ls -la src-tauri/target/release/bundle/
