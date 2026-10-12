/**
 * Хранение проектов в localStorage — ВРЕМЕННОЕ решение до бэкенда.
 *
 * R5 требует, чтобы исследование переживало перезагрузку страницы и переезд
 * на другую машину, поэтому список проектов и их снимки пишутся в браузерное
 * хранилище. Это не данные из AppService (бэк ещё не умеет хранить проекты) —
 * при подключении бэка этот модуль заменяется на запросы к нему, а форма
 * ProjectRecord остаётся той же.
 *
 * Раскладка ключей:
 *   edinoros-projects       — индекс ProjectMeta[]: один список для стартовой
 *                             страницы, без тел проектов;
 *   edinoros-project-<id>   — ProjectRecord: метаданные + снимок данных.
 *
 * Индекс отделён от тела: стартовая страница читает один ключ и не тащит
 * за собой снимки (модели, наблюдения, результат проверки).
 *
 * Снимок хранится в форме ProjectExportFile — ровно том формате, в котором
 * проект выгружается и импортируется (R6.4). Один формат на чтение и запись:
 * экспорт проекта = содержимое проекта в файле.
 */
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectExportFile,
} from "@/src/lib/export/project-export";

/** Ключ индекса проектов. */
export const PROJECTS_INDEX_KEY = "edinoros-projects";
/** Префикс ключей тел проектов: <prefix><id>. */
export const PROJECT_KEY_PREFIX = "edinoros-project-";
/**
 * Демонстрационный проект («Открыть демо»). Фиксированный id, чтобы второй
 * клик открывал тот же проект, а не создавал новый.
 */
export const DEMO_PROJECT_ID = "proj-demo";

/** Сведения о записи PCAP, которой владеет проект. */
export interface ProjectCaptureMeta {
  /** Имя файла записи; null — в проекте нет записи. */
  fileName: string | null;
  sizeBytes: number;
  sessionCount: number;
  messageCount: number;
}

/** Метаданные проекта — то, что показывается в списке. */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  meta: ProjectCaptureMeta;
}

/** Проект целиком: метаданные + снимок данных. */
export interface ProjectRecord {
  meta: ProjectMeta;
  /** Снимок (R6.4); null — проект создавался и ещё не сохранялся. */
  data: ProjectExportFile | null;
}

/** Доступ к localStorage недоступен на сервере и в приватном режиме. */
function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  const store = storage();
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch {
    // Переполнение или запрет хранения — сообщаем вызывающей стороне.
    return false;
  }
}

function dropRaw(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Нечего удалять — переживать не о чем.
  }
}

/** Проверка метаданных, прочитанных из JSON: лишние поля не валидируем. */
function isProjectMeta(value: unknown): value is ProjectMeta {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.createdAt !== "string" ||
    typeof item.updatedAt !== "string"
  ) {
    return false;
  }
  const meta = item.meta;
  if (typeof meta !== "object" || meta === null) return false;
  const capture = meta as Record<string, unknown>;
  if (capture.fileName !== null && typeof capture.fileName !== "string") {
    return false;
  }
  return (
    typeof capture.sizeBytes === "number" &&
    typeof capture.sessionCount === "number" &&
    typeof capture.messageCount === "number"
  );
}

/** Индекс проектов для стартовой страницы. Повреждение ключа — пустой список. */
export function readIndex(): ProjectMeta[] {
  const raw = readRaw(PROJECTS_INDEX_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const items: ProjectMeta[] = [];
    for (const item of parsed) {
      if (isProjectMeta(item)) items.push(item);
    }
    return items;
  } catch {
    return [];
  }
}

/** Запись индекса; false — хранилище недоступно или переполнено. */
export function writeIndex(metas: ProjectMeta[]): boolean {
  return writeRaw(PROJECTS_INDEX_KEY, JSON.stringify(metas));
}

/** Тело проекта по id; null — не найден или не читается. */
export function readRecord(id: string): ProjectRecord | null {
  const raw = readRaw(PROJECT_KEY_PREFIX + id);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!isProjectMeta(record.meta)) return null;

    const data = record.data;
    if (data !== null && typeof data !== "object") return null;

    return { meta: record.meta, data: (data ?? null) as ProjectExportFile | null };
  } catch {
    return null;
  }
}

/** Запись тела проекта; false — хранилище недоступно или переполнено. */
export function writeRecord(record: ProjectRecord): boolean {
  return writeRaw(PROJECT_KEY_PREFIX + record.meta.id, JSON.stringify(record));
}

/** Удаление тела проекта. Индекс обновляет вызывающая сторона. */
export function removeRecord(id: string): void {
  dropRaw(PROJECT_KEY_PREFIX + id);
}

/** Новый id проекта: не зависит от crypto (работает и на http-локалке). */
export function nextProjectId(): string {
  const stamp = Date.now().toString(36);
  const tail = Math.random().toString(36).slice(2, 10);
  return `proj-${stamp}-${tail}`;
}

/**
 * Имя проекта из имени файла: снимаются расширения записи и экспорта
 * проекта. Пустой результат — исходное имя (тогда уж лучше ничего не терять).
 */
export function projectTitle(fileName: string): string {
  const base = fileName
    .replace(/\.(pcapng|pcap|cap|project\.json|json)$/i, "")
    .trim();
  return base.length > 0 ? base : fileName;
}

/** Пустой снимок проекта — для экспорта проекта, который ещё не сохранялся. */
export function emptyProjectData(): ProjectExportFile {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    metadata: {
      exportedAt: new Date().toISOString(),
      author: null,
    },
    capture: null,
    active: {
      modelId: null,
      sessionId: null,
      messageId: null,
      fieldsSource: "json",
    },
    models: [],
    observations: [],
    checkResult: null,
  };
}
