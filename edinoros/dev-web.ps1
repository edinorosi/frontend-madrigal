# Обёртка: веб-версия (бэкенд :8080 + фронтенд :3000).
Set-Location -LiteralPath $PSScriptRoot
docker compose up -d
Write-Host "Открыть: http://localhost:3000 (API: http://localhost:8080)"
