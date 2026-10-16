# Лаборатория протоколов — запуск

Фронтенд (Next.js + Tauri) + бэкенд (Rust/Axum, :8080). Всё запускается из
`frontend-madrigal/edinoros/`. Репозиторий `backend-madrigal/` должен лежать
**рядом** (соседней папкой) — так его ждут `docker-compose.yml` и `tauri.conf.json`.

## 4 способа развернуть

| # | Способ | Кому/зачем | Команда (из `edinoros/`) |
|---|---|---|---|
| 1 | **Docker — веб** | Быстрый старт, демо в браузере, любая ОС | `docker compose up -d` → http://localhost:3000 |
| 2 | **Docker — Tauri-инсталлятор** | Собрать Linux `.deb`/`.rpm`/`.AppImage` на любой ОС | `docker compose --profile tauri-build up tauri-build` |
| 3 | **Нативно на Linux** | Разработка/отладка Tauri (GUI) | `npx tauri dev` (или `npx tauri build`) |
| 4 | **Готовый инсталлятор** | Просто установить, без сборки | `src-tauri/target/release/bundle/` |

> **Хакатон-эксперту — способ 1.** Две команды и браузер:
> ```bash
> cd frontend-madrigal/edinoros
> docker compose up -d        # веб на http://localhost:3000, API на :8080
> ```
> Нужен только Docker (или Podman). Остановить: `docker compose down`.

## Что где

- **1. Docker веб** — фронт `:3000`, API `:8080/api/v1`. Обёртки: `./dev-web.sh`, `dev-web.ps1`.
- **2. Docker Tauri** — собирает sidecar-бэкенд, `npm ci`, `npx tauri build`. Артефакты:
  `src-tauri/target/release/bundle/{deb,rpm,appimage}/`. Обёртки: `./build-tauri-linux.sh`, `.ps1`.
- **3. Нативно** — нужны Node 20+, Rust и системные библиотеки (ниже). Sidecar-бинарь
  бэкенда положить в `src-tauri/binaries/` (см. `build-tauri.sh`), а на фикстуры сделать
  ссылку рядом с репозиторием: `ln -sfn backend-madrigal ../backend`.
- **4. Готовый инсталлятор** — результат способа 2 (sidecar и фикстуры внутри):
  ```bash
  chmod +x edinoros_0.1.0_amd64.AppImage && ./edinoros_0.1.0_amd64.AppImage   # AppImage
  sudo apt install ./edinoros_0.1.0_amd64.deb                                  # Debian/Ubuntu
  sudo dnf install ./edinoros-0.1.0-1.x86_64.rpm                               # Fedora/RHEL
  ```

## Системные зависимости для способа 3

```bash
# Debian/Ubuntu
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libxdo-dev libssl-dev build-essential pkg-config
# Fedora
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \
  librsvg2-devel libxdo-devel openssl-devel
# Arch
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg xdotool openssl base-devel
```

## Если что-то не так

| Симптом | Решение |
|---|---|
| `no compose.yaml ... found` | команда запущена не из `frontend-madrigal/edinoros` |
| `Permission denied` при Tauri-сборке (Fedora) | SELinux; в `docker-compose.yml` у mount'ов должен быть `:z` |
| `couldn't read ... scripts/protocol-lab-py/...` | устаревший `backend-madrigal`; скрипты — в `backend-madrigal/scripts/` |
| `pkg-config ... not found` (способ 3) | не установлены системные dev-пакеты (см. выше) |

Детали Docker — `README-DOCKER.md`. Контракт фронта и бэка, типы, запреты — `AGENTS.md`.
