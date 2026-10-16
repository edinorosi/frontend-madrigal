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

## Podman

На Fedora/RedHat вместо Docker можно использовать Podman. 
Команды аналогичны, но вместо `docker` используйте `podman`/`podman-compose`.

### Веб-версия

```bash
cd frontend-madrigal/edinoros
podman compose up -d        # или podman-compose up -d
# либо через обёртку ./dev-web.sh — она автоопределит docker/podman
```

### Сборка Linux Tauri через Podman

```bash
cd frontend-madrigal/edinoros
podman compose --profile tauri-build up --build tauri-build
# либо ./build-tauri-linux.sh
```

### Остановка

```bash
podman compose down
podman compose --profile tauri-build down
podman compose down -v
```

### Возможные проблемы

- **npm ci падает в Podman-сборке:** синхронизируйте `package-lock.json` с `package.json`. В проекте фронта корректный lock обязателен. Если локально `npm install` изменил lock — закоммитьте его.
- **Нет доступа к сети/слоям при первой сборке:** убедитесь, что `podman` настроен, достаточно места в `/var/lib/containers/`.
- **Порты заняты:** измените маппинг в `docker-compose.yml` при необходимости.

```
