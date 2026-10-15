# Обёртка: сборка Linux Tauri-инсталлятора (.deb/.AppImage) в контейнере.
Set-Location -LiteralPath $PSScriptRoot
docker compose --profile tauri-build up --build tauri-build
Write-Host "Артефакты: src-tauri/target/release/bundle/"
