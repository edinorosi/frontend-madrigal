# Docker — «Лаборатория протоколов»

Все команды — из папки `frontend-madrigal/edinoros/`.

## Требования

- Docker Desktop (Windows/macOS) или Docker Engine + compose (Linux).
- Оба репо клонированы соседними папками:
  - `frontend-madrigal/edinoros/`
  - `backend-madrigal/`

## Три сценария

### 1. Веб-версия (Windows / Linux)

```bash
cd frontend-madrigal/edinoros
docker compose up -d          # или ./dev-web.sh / dev-web.ps1
```

Открыть: http://localhost:3000 (фронт, статика из `out/`), API: http://localhost:8080.

`NEXT_PUBLIC_API_URL` вшивается в бандл на этапе сборки (`build-arg`, по умолчанию `http://localhost:8080`) — браузер ходит к бэку напрямую через опубликованный порт хоста.

### 2. Linux Tauri installer (Windows / Linux)

Собрать `.deb` / `.AppImage` на любой ОС (через Linux-контейнер):

```bash
cd frontend-madrigal/edinoros
docker compose --profile tauri-build up tauri-build   # или ./build-tauri-linux.sh / .ps1
```

Артефакты на хосте: `frontend-madrigal/edinoros/src-tauri/target/release/bundle/` (`deb/`, `appimage/`).

Сборка монтирует исходники volume'ами, кэши Rust и `node_modules` живут в именованных volume'ах (`cargo-cache`, `node-cache`) — повторные сборки быстрее.

### 3. Tauri dev (только Linux, нативно)

В Docker не работает (GUI). На Linux напрямую:

```bash
cd frontend-madrigal/edinoros
npx tauri dev
```

Бинарь sidecar `protocol-lab-api-$(uname -m)-unknown-linux-gnu` кладётся в `src-tauri/binaries/` (Tauri сам скачает/скомпилирует при необходимости — см. AGENTS.md).

## Ограничения Docker

- Только Linux Tauri build. Windows/macOS installer — собираются только на своей ОС, из Docker это не кросс-компилируется.
- `tauri dev` с GUI — не в Docker.

## Остановка и очистка

```bash
docker compose down                        # остановить веб
docker compose --profile tauri-build down  # + контейнер tauri-build
docker compose down -v                     # удалить volume'ы (в т.ч. data/)
```
