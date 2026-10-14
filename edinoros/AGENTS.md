# Лаборатория протоколов — фронтенд

## 1. Что это за проект

Локальный инструмент для исследования недокументированного бинарного обмена с устройством поверх TCP. Инженер открывает запись PCAP, сопоставляет её с журналом действий, формулирует гипотезы о структуре сообщений и проверяет их на новых данных. Результат должен быть привязан к исходным байтам и воспроизводиться после передачи проекта другому инженеру.

Это репозиторий **фронтенда**: Next.js, App Router, статический экспорт. Бэкенд — отдельный репозиторий `backend-madrigal` (Rust, Axum, :8080), его делают параллельно другие люди. Пока роуты бэка не совпадают с `AppService`, фронт работает на моках: `mockService` реализует ровно тот интерфейс, который предстоит реализовать бэкенду. Переключение на HTTP — через `NEXT_PUBLIC_API_URL` (см. §3, «Интеграция с бэкендом»).

Целевая среда сейчас — браузер (`npm run dev`). Сборка под Tauri планируется позже; `output: 'export'` в `next.config.ts` держится под неё и ломать его нельзя.

## 2. Кто что делает

**Фронт:** весь UI и раскладка, интерфейс `AppService`, `mockService` + `httpService`, мок-данные, HEX-дамп, мини-карта, ReferenceChip, панель интерпретации, состояния, горячие клавиши.

**Бэк:** парсинг PCAP/PCAPNG, реконструкция TCP-потока, фрейминг, применение модели разбора, проверка на корпусе, хранение проекта на диске, работа с файлами. Бэкенд — Rust, отдельный репозиторий `backend-madrigal`. Фронт не пишет код на Rust и не трогает этот репозиторий; стыковка — HTTP (`httpService` + роуты из §3).

Границы жёсткие. Всё из списка бэка фронт не делает. Если увидишь такое в фронтовом коде — это ошибка.

## 3. Контракт стыковки

### AppService — 10 методов

`src/services/appService.ts` — точка подключения бэкенда.

| Метод | Что отдаёт |
|---|---|
| `listCaptures(): Promise<Capture[]>` | список записей |
| `importCapture(file: File): Promise<Capture>` | импорт PCAP |
| `listSessions(captureId: string): Promise<Session[]>` | сессии записи |
| `listMessages(sessionId: string, direction?: Direction): Promise<Message[]>` | сообщения |
| `getBytes(captureId: string, offset: number, length: number): Promise<Uint8Array>` | сырые байты |
| `saveObservation(obs: Observation): Promise<void>` | сохранение наблюдения |
| `removeObservation(id: string): Promise<void>` | удаление наблюдения |
| `listObservations(messageId: string): Promise<Observation[]>` | наблюдения сообщения |
| `listActions(captureId: string): Promise<Action[]>` | журнал действий оператора (R4) |
| `checkModel(captureId: string, modelId?: string): Promise<CheckResult>` | прогон модели по журналу (R4) |

Семантика, которую нужно соблюсти:

- `listMessages` **без** `direction` — обе стороны одним потоком, упорядоченным по времени. С `direction` — фильтр по одной стороне.
- `getBytes` — `offset` отсчитывается **от начала байтового потока записи**, а не от начала сообщения. Байты сообщения читаются как `getBytes(captureId, message.byteOffset, message.length)`.
- `saveObservation` — **upsert по `id`**: сохранение с существующим id правит наблюдение, с новым — создаёт. Отдельного метода правки нет и не нужно.
- `removeObservation` — добавлен сверх исходного ТЗ, согласован с заказчиком.
- `listActions` и `checkModel` — добавлены под задачу R4 «Проверка» (журнал действий — исходные данные исследования по ТЗ; без него R4 не выполняется). В `checkModel` бэк извлекает значения из разобранных сообщений и сопоставляет с журналом: `ok` — совпало, `unknown` — сообщение не разобрано или привязки нет, `error` — значения расходятся. Каждая `CheckRow` несёт `expected` (ожидание журнала, из `Action.value`) и `extracted` (извлечение модели из байт) — панель рисует их раздельными колонками. `modelId` пока необязательный.

> `listActions` и `checkModel` — расширение контракта под R4. Типы `Action`, `CheckRow`, `CheckStatus`, `CheckResult` — часть общих типов (`src/types/domain.ts`), не выдумывать дубли.

### Точка подмены

`src/services/index.ts` выбирает реализацию `AppService` по `NEXT_PUBLIC_API_URL`:

```ts
export const appService: AppService = process.env.NEXT_PUBLIC_API_URL
  ? httpService   // бэкенд backend-madrigal, Axum, :8080
  : mockService;  // оффлайн-разработка на моках
```

Это единственное место, которое меняется при подключении бэка. Остальное приложение работает через `appService` и о моках/HTTP не знает.

### Интеграция с бэкендом (HTTP)

Бэкенд — отдельный репозиторий `backend-madrigal` (Rust, cargo-workspace `core` + `api`, Axum). Не переносить в `src-tauri/`. Сейчас — HTTP, Tauri (sidecar) — позже.

**Запуск в dev (два терминала):**

```bash
# терминал 1 — бэкенд (из backend-madrigal)
cargo run -p protocol-lab-api          # слушает http://localhost:8080

# терминал 2 — фронтенд (из edinoros)
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

Без `NEXT_PUBLIC_API_URL` фронт работает на моках (оффлайн). Заданная переменная переключает все методы `AppService` на HTTP к `:8080`.

`src/services/httpService.ts` — вторая реализация `AppService` через `fetch`. HTTP-слой (`requestJson`) уже готов: таймаут 15 с, разбор ошибок 4xx/5xx, `HttpServiceError` с понятным сообщением (его ловит `describeError` в сторе). Пока **ни один** из 14 методов не подключён по-настоящему: форматы роутов бэка не совпадают с `domain.ts` — каждый метод кидает `routeMissing(method, expectedRoute)`. Когда бэк добавит роуты — заменить `routeMissing` на `requestJson<T>(...)`.

### Ошибки в workspace

Ошибки загрузки проекта (например, `loadProject` → `listCaptures` → «HTTP: метод ещё не реализован на бэке») показываются **баннером в верхней части рабочей области** (`components/layout/work-area.tsx`, под `importDoneNotice`). Раньше ошибка гасла в пустом центре с текстом «Проект пуст» — её больше так не прячем.

Как устроено:
- Текст берётся из `state.error` (заполняется `describeError` в сторе).
- Подпись для `routeMissing` перефразируется («ещё не реализован на бэке — данные недоступны»), для «Нет связи с бэкендом» добавляется подсказка «Проверьте, что бэкенд запущен».
- **[Повторить]** — повторяет `loadProject()` (стор).
- **[Скрыть]** — локальное состояние в `work-area.tsx`; при новом изменении `state.error` баннер появляется снова. Стор и `app.error` не трогаем.

Типы ошибок, которые сюда попадают: HTTP-ошибки (`HttpServiceError` с кодом ответа), сетевые ошибки и таймауты (`requestJson`), «метод не реализован» (`routeMissing`). Моки (`mockService`) сюда не приходят — в них ошибок загрузки нет.

### Роуты, которые нужны на бэке (артефакт для бэкенд-разработчика)

Форматы — по `src/types/domain.ts`. Пока ни один не реализован.

| Метод AppService | Нужный роут | Request | Response |
|---|---|---|---|
| `listCaptures()` | `GET /api/v1/captures` | — | `Capture[]` |
| `importCapture(file)` | `POST /api/v1/captures` | multipart `file` | `Capture` |
| `listSessions(captureId)` | `GET /api/v1/captures/:captureId/sessions` | — | `Session[]` |
| `listMessages(sessionId, direction?)` | `GET /api/v1/sessions/:sessionId/messages` | query `direction?` = `request`\|`response` | `Message[]` (обе стороны одним потоком, по времени; с `direction` — фильтр) |
| `getBytes(captureId, offset, length)` | `GET /api/v1/captures/:captureId/bytes` | query `offset`, `length` | `application/octet-stream` (сырые байты; offset от начала потока записи) |
| `saveObservation(obs)` | `PUT /api/v1/observations` | тело `Observation` | 204; upsert по `id` |
| `removeObservation(id)` | `DELETE /api/v1/observations/:id` | — | 204 |
| `listObservations(messageId)` | `GET /api/v1/messages/:messageId/observations` | — | `Observation[]` |
| `listActions(captureId)` | `GET /api/v1/captures/:captureId/actions` | — | `Action[]` |
| `checkModel(captureId, modelId?)` | `POST /api/v1/check` | `{ captureId, modelId? }` | `CheckResult` (rows + summary) |
| `listModels()` | `GET /api/v1/models` | — | `Model[]` |
| `saveModel(model)` | `PUT /api/v1/models` | тело `Model` | 204; upsert по `id` |
| `removeModel(modelId)` | `DELETE /api/v1/models/:modelId` | — | 204 |
| `applyModel(messageId, modelId)` | `POST /api/v1/messages/:messageId/apply-model` | `{ modelId }` | `MessageField[]` |

Обязательные поля по типам: `Capture.id/fileName/importedAt/sizeBytes/sessionCount`, `Session.id/captureId/tuple/messageCount/startedAt`, `Message.id/sessionId/packetNumber/byteOffset/direction/role/length/status/label/timestamp/interpretation/verified/fields[]`, `MessageField.id/name/type/value/range`, `Observation.id/messageId/kind/createdAt`, `Model.id/name/status/rules[]`, `CheckResult.rows[]/summary{total,ok,partial,unknown,error}`.

Семантика (обязательна для бэка): `listMessages` без `direction` — обе стороны одним потоком, упорядоченным по времени; `getBytes.offset` — отсчёт от начала байтового потока записи (не от сообщения); `saveObservation`/`saveModel` — upsert по `id`.

### Типы — единственный источник правды

`src/types/domain.ts`. Обе стороны используют одни и те же типы, своих дублей не заводить.

Ключевые: `Capture`, `Session`, `Message`, `Observation`, `ByteRange`, `MessageField`.
Перечисления: `Direction` (`request` / `response`), `MessageRole` (`REQ` / `RSP` / `NOTIFY`), `ParseStatus` (`parsed` / `unknown` / `error`), `ObservationStatus` (`draft` / `confirmed` / `refuted` / `stale`), `ObservationKind`, `InterpretationStatus`.

Если бэкенду нужно генерировать типы самому (например, через tauri-specta) — они должны быть совместимы с этими.

Неочевидные места:

- `Observation.status` необязателен. В моках его нет — там лежит устаревшее `hypothesis`; статус выводится через `resolveObservationStatus` (`src/lib/observations.ts`).
- `Message.fields` — уже разобранные поля (имя, тип, значение, `range` с привязкой к байтам). Их считает бэк, применяя модель разбора. Фронт только рисует.
- `Observation.ruleId` необязателен (R9.2, согласовано с бэком): id правила модели, на котором основано наблюдение. Фронт заполняет его автоматически при создании наблюдения, если выделение попадает в поле правила; бэк хранит и возвращает поле как есть.
- `Message.modelId` необязателен (R10.1, согласовано с бэком): ссылка на модель разбора сообщения. Отсутствие — сообщение разбирается активной моделью проекта. Бэк хранит и возвращает поле как есть; привязки фронта живут в сторе (`messageModels`) и в блоке `active` снимка проекта.

### Мок-данные — тоже контракт

`src/mocks/*.json` показывают форму данных, которую ждёт фронт. Это не примеры «на глазок», а рабочий набор, покрывающий крайние случаи: сообщение в 4 байта и в 4 КиБ, статусы `unknown` и `error`, сессия с одним сообщением и сессия на 300, наблюдение без комментария, сообщение без наблюдений. `actions.json` — журнал действий для R4: строки со статусами `ok`, `unknown` (непроверенные) и `error` (расхождение) присутствуют намеренно.

Пересобираются скриптом: `node scripts/generate-mock-data.mjs`.

## 4. Запреты для бэкендеров

- **Не верстать UI-компоненты.** Вся вёрстка — фронт. Бэкендер, пишущий компонент, делает ошибку.
- Не добавлять и не менять методы `AppService` без согласования с фронтом. Контракт финальный.
- Не менять типы в `src/types/` самостоятельно — они общие. Нужен новый тип или поле: сначала спросить.
- Не парсить PCAP на фронте. Это бэк.

## 5. Запреты для фронта

- Никаких Server Components, API Routes, Server Actions, SSR, middleware.
- Никакого `any` в TypeScript.
- Никаких готовых таблиц (TanStack Table, AG Grid, MUI DataGrid) для HEX-дампа и списков: виртуализация своя, через `@tanstack/react-virtual`.
- Никаких грубых хаков (`!important`, `overflow: hidden` против прокрутки, JS ради визуала) без обоснования.
- Никакой телеметрии, аналитики, обращений к внешним API.
- Слова «фрейминг», «корпус», «контрпример», «происхождение» в UI не использовать.

## 6. Как запускать

```bash
npm run dev          # веб-версия, http://localhost:3000 (моки, оффлайн)
npm run build        # статический экспорт в out/
npm run lint         # ESLint — сейчас может не работать, см. ниже
npx tsc --noEmit     # проверка типов
```

С бэкендом (два терминала, см. §3 «Интеграция с бэкендом»):

```bash
# бэкенд (из ../backend-madrigal)
cargo run -p protocol-lab-api

# фронтенд (из edinoros)
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

> `npm run lint` временно недоступен: конфиг ESLint (`eslint.config.mjs`) удалён коммитом коллеги, работа над ним идёт. Скрипт и зависимости на месте — команду не удалять. Понадобился линт — спросите пользователя; восстанавливать конфиг самостоятельно нельзя.

Tauri — позже, не сейчас. План: бинарь `protocol-lab-api` запускается как sidecar, фронт ходит на `http://127.0.0.1:8080` — транспорт тот же HTTP (`httpService`), IPC Tauri-commands не нужен. `output: 'export'` в `next.config.ts` держится под Tauri и ломать его нельзя.

## 7. Кроссплатформенность

Над проектом работают два разработчика на разных ОС: Windows и Arch Linux. **Код обязан работать на обеих без модификаций.** Репозиторий общий: всё, что делает один, влияет на другого.

### Пути

- В Node-коде — `path.join` / `path.sep`, а не склейка строк. Хардкодить `\` или `/` нельзя.
- В TypeScript-импортах — только алиас `@/` или относительные пути с `/`. Обратные слэши не использовать.
- В CSS и HTML — только `/`.
- В Rust (бэк) — `std::path::Path` / `PathBuf`, а не строки.

### Регистр имён файлов

На Windows `File.txt` и `file.txt` — одно и то же. На Linux — **разные файлы**. Поэтому импорт обязан повторять имя файла посимвольно, как оно записано в репозитории: `hex-dump.tsx` импортируется как `@/components/hex/hex-dump`, а не `HexDump` и не `hex_dump`.

Это самый коварный класс ошибок здесь: на Windows проявится не сразу или не проявится вовсе, а на Linux сборка упадёт.

### Переносы строк

- Целевой формат — **LF**.
- `.editorconfig`: `end_of_line = lf`.
- `.gitattributes`: `* text=auto eol=lf`.

> На момент написания **ни `.editorconfig`, ни `.gitattributes` в репозитории нет** — ни в корне, ни в `edinoros/`. Создавать их самостоятельно нельзя: это зона коллеги, спросите пользователя.

### npm-скрипты

- Только кроссплатформенные команды. `rm -rf`, `cp`, `mkdir -p`, `NODE_ENV=...` в скриптах не работают в cmd.
- Вместо `rm -rf` — `rimraf`, вместо `NODE_ENV=production` — `cross-env`.
- Меняя скрипты, проверяйте, что команда работает и в cmd, и в bash.

### Shell-скрипты и права

- `.sh`-скрипты для автоматизации не добавлять, если можно обойтись. Если добавляете — они опциональны и не вызываются из `npm run`.
- `chmod +x` на Windows не работает: не полагайтесь на права файлов в логике проекта.

### Симлинки

Не использовать — на Windows они работают иначе.

### `.gitignore`

Общий, один, в корне репозитория. Локальные в подпапках без явной причины не создавать. Добавляя игнор — в корневой и после согласования с пользователем.

### Чужие изменения

- `eslint.config.mjs`, `.gitignore`, скрипты в `package.json` — зона коллеги. Не восстанавливать, не удалять, не править.
- Что-то кажется сломанным — сообщить пользователю с деталями, не чинить самостоятельно.
- Коммиты, которых вы не делали, — норма, работает коллега.

## 8. Словарь UI

«Сессии», «Сообщения», «Байты», «Поля», «Наблюдения», «Модель», «Проверка».

## 9. Ключевые файлы

| Путь | Что |
|---|---|
| `src/services/appService.ts` | контракт, 10 методов |
| `src/services/index.ts` | точка подмены мока на бэк |
| `src/types/domain.ts` | общие типы |
| `src/mocks/` | образцы данных |
| `components/hex/` | HEX-дамп, мини-карта, панель действий, контекстное меню |
| `components/` | остальной UI |
| `components/dev/dev-menu.tsx` | тестовый пульт; в production-сборку не попадает, при подключении бэка удаляется вместе с `src/services/mock/scenarios.ts` |
