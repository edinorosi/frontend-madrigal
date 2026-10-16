/**
 * Экспорт проекта целиком (R6.4) — один JSON со всем исследованием:
 * модели, наблюдения, настройки, метаданные PCAP, последняя проверка.
 *
 * Формат отделён от доменного типа — это контракт обмена с версией схемы.
 * Содержимое PCAP не выгружается: только ссылки (имя, размер, дата).
 */
import { parseJsonObject } from "@/src/lib/export/model-export";
import type { ExportData } from "@/src/lib/export/report";
import type {
  Capture,
  CheckResult,
  Model,
  Observation,
} from "@/src/types/domain";

/** Текущая версия схемы экспорта проекта. */
export const PROJECT_SCHEMA_VERSION = 1;

/** Ссылка на запись проекта (R6.4-расширение, обратно совместимо). */
export interface ProjectCaptureRef {
  id: string;
  fileName: string;
  importedAt: string;
  sizeBytes: number;
  sessionCount: number;
}

/** Конверт экспорта проекта. */
export interface ProjectExportFile {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  metadata: {
    exportedAt: string;
    author: string | null;
  };
  /** Ссылки на PCAP — само содержимое записи не выгружается. */
  capture: {
    id: string;
    fileName: string;
    importedAt: string;
    sizeBytes: number;
    sessionCount: number;
  } | null;
  /**
   * Все записи проекта (активная — в `capture`). Отсутствие — старый файл,
   * тогда считается, что в проекте только `capture`.
   */
  captures?: ProjectCaptureRef[];
  /** Настройки исследования — активные сущности и источник полей. */
  active: {
    modelId: string | null;
    sessionId: string | null;
    messageId: string | null;
    fieldsSource: "json" | "model";
    /**
     * Активная запись проекта (id из captures[]). Необязательно:
     * отсутствие — активная запись определяется полем `capture`
     * (снапшоты из localStorage) либо первой из `captures[]`.
     * Расширение schemaVersion 1, обратно совместимо.
     */
    captureId?: string | null;
    /**
     * Привязки сообщений к моделям (R10.1): messageId → modelId.
     * Необязательно: отсутствие — все сообщения разбираются активной
     * моделью. Расширение schemaVersion 1, обратно совместимо.
     */
    messageModels?: Record<string, string>;
  };
  models: Model[];
  observations: Observation[];
  /** Результат последней проверки; null — проверка не запускалась. */
  checkResult: CheckResult | null;
}

/** Ссылка на запись для снимка/экспорта: только идентифицирующие поля. */
export function captureRefOf(capture: Capture): ProjectCaptureRef {
  return {
    id: capture.id,
    fileName: capture.fileName,
    importedAt: capture.importedAt,
    sizeBytes: capture.sizeBytes,
    sessionCount: capture.sessionCount,
  };
}

/** Сборка конверта проекта из снимка данных. */
export function buildProjectExport(
  data: ExportData,
  active: ProjectExportFile["active"],
  captures?: Capture[],
): ProjectExportFile {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    metadata: {
      exportedAt: data.generatedAt,
      author: null,
    },
    capture: data.capture
      ? {
          id: data.capture.id,
          fileName: data.capture.fileName,
          importedAt: data.capture.importedAt,
          sizeBytes: data.capture.sizeBytes,
          sessionCount: data.capture.sessionCount,
        }
      : null,
    active: { ...active, captureId: activeCaptureIdOf(data, active) },
    models: data.model ? replaceActive(data.models, data.model) : data.models,
    observations: data.observations,
    checkResult: data.checkResult,
    captures: (captures ?? (data.capture ? [data.capture] : [])).map(
      captureRefOf,
    ),
  };
}

/** Активная запись снапшота: id активной записи для восстановления. */
function activeCaptureIdOf(
  data: ExportData,
  active: ProjectExportFile["active"],
): string | null {
  if (data.capture) return data.capture.id;
  return active.captureId ?? null;
}

/** Активная модель могла быть изменена после загрузки списка — подменяем. */
function replaceActive(models: Model[], active: Model): Model[] {
  const index = models.findIndex((item) => item.id === active.id);
  if (index < 0) return [...models, active];
  return models.map((item) => (item.id === active.id ? active : item));
}

/**
 * Приводит снимок проекта к записям, реально существующим в сервисе.
 *
 * Записи снимка (`captures[]`) фильтруются по `availableCaptureIds`,
 * активная выбирается по `active.captureId`, иначе — первая из оставшихся.
 * Если не осталось ни одной, `capture = null` и `captures = []` — сигнал
 * открыть проект с пустым выбором, не обращаясь к пропавшей записи (иначе
 * `listSessions` вернул бы 404 «Capture not found»).
 *
 * При разборе файла доступными считаются id самого файла (проверка
 * структуры); при открытии проекта — id из `listCaptures()`.
 */
export function normalizeProjectData(
  data: ProjectExportFile,
  availableCaptureIds: readonly string[],
): ProjectExportFile {
  const available = new Set(availableCaptureIds);
  const captures = (data.captures ?? []).filter((item) =>
    available.has(item.id),
  );
  const capture =
    captures.find((item) => item.id === data.active.captureId) ??
    captures[0] ??
    null;
  return { ...data, capture, captures };
}

/**
 * Разбор и валидация файла проекта. Бросает Error с русским сообщением.
 * Идентификаторы сохраняются как есть: импорт проекта восстанавливает
 * состояние, а не создаёт копии.
 */
export function parseProjectExport(raw: string): ProjectExportFile {
  const file = parseJsonObject(raw, "файл проекта");

  if (file.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Несовместимая версия схемы: ${describeValue(file.schemaVersion)} (ожидается ${PROJECT_SCHEMA_VERSION})`,
    );
  }

  const modelsRaw = file.models;
  if (!Array.isArray(modelsRaw)) {
    throw new Error("в файле нет списка моделей models");
  }
  const models = modelsRaw.map((item, index) => parseModel(item, index));

  const observationsRaw = file.observations;
  if (!Array.isArray(observationsRaw)) {
    throw new Error("в файле нет списка наблюдений observations");
  }
  const observations = observationsRaw.map((item, index) =>
    parseObservation(item, index),
  );

  const activeRaw = file.active;
  if (typeof activeRaw !== "object" || activeRaw === null) {
    throw new Error("в файле нет объекта active");
  }
  const activeSource = activeRaw as Record<string, unknown>;
  const activeCaptureId =
    typeof activeSource.captureId === "string" &&
    activeSource.captureId.length > 0
      ? activeSource.captureId
      : null;
  const messageModelsRaw = activeSource.messageModels;
  const messageModels: Record<string, string> = {};
  if (
    typeof messageModelsRaw === "object" &&
    messageModelsRaw !== null &&
    !Array.isArray(messageModelsRaw)
  ) {
    for (const [key, value] of Object.entries(
      messageModelsRaw as Record<string, unknown>,
    )) {
      if (typeof value === "string" && value.length > 0) {
        messageModels[key] = value;
      }
    }
  }
  const active: ProjectExportFile["active"] = {
    modelId: typeof activeSource.modelId === "string" ? activeSource.modelId : null,
    sessionId:
      typeof activeSource.sessionId === "string" ? activeSource.sessionId : null,
    messageId:
      typeof activeSource.messageId === "string" ? activeSource.messageId : null,
    fieldsSource: activeSource.fieldsSource === "model" ? "model" : "json",
    captureId: activeCaptureId,
    messageModels,
  };

  let checkResult: CheckResult | null = null;
  if (
    typeof file.checkResult === "object" &&
    file.checkResult !== null &&
    Array.isArray((file.checkResult as Record<string, unknown>).rows)
  ) {
    checkResult = file.checkResult as CheckResult;
  }

  let captures: ProjectCaptureRef[] | undefined;
  if (Array.isArray(file.captures)) {
    const list: ProjectCaptureRef[] = [];
    for (const raw of file.captures) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== "string" || item.id.length === 0) continue;
      list.push({
        id: item.id,
        fileName: typeof item.fileName === "string" ? item.fileName : item.id,
        importedAt: typeof item.importedAt === "string" ? item.importedAt : "",
        sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : 0,
        sessionCount:
          typeof item.sessionCount === "number" ? item.sessionCount : 0,
      });
    }
    captures = list;
  }

  // Активная запись и состав списка восстанавливаются нормализацией по
  // доступным записям (для файла — по его собственному списку captures[]):
  // capture по active.captureId, иначе — первая; null — список пуст.
  // Старый файл без captures[] так же остаётся без записи (capture = null).
  const parsed: ProjectExportFile = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    metadata: {
      exportedAt:
        typeof (file.metadata as Record<string, unknown> | undefined)
          ?.exportedAt === "string"
          ? ((file.metadata as Record<string, unknown>).exportedAt as string)
          : new Date().toISOString(),
      author: null,
    },
    capture: null,
    active,
    models,
    observations,
    checkResult,
    ...(captures !== undefined ? { captures } : {}),
  };

  return normalizeProjectData(
    parsed,
    captures?.map((item) => item.id) ?? [],
  );
}

function parseModel(raw: unknown, index: number): Model {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`модель ${index + 1}: ожидался объект`);
  }
  const model = raw as Record<string, unknown>;
  if (typeof model.id !== "string" || model.id.length === 0) {
    throw new Error(`модель ${index + 1}: нет id`);
  }
  if (typeof model.name !== "string" || model.name.trim().length === 0) {
    throw new Error(`модель ${index + 1}: нет имени`);
  }
  if (!Array.isArray(model.rules)) {
    throw new Error(`модель «${model.name}»: нет списка правил rules`);
  }
  return model as unknown as Model;
}

function parseObservation(raw: unknown, index: number): Observation {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`наблюдение ${index + 1}: ожидался объект`);
  }
  const observation = raw as Record<string, unknown>;
  if (typeof observation.id !== "string" || observation.id.length === 0) {
    throw new Error(`наблюдение ${index + 1}: нет id`);
  }
  if (
    typeof observation.messageId !== "string" ||
    observation.messageId.length === 0
  ) {
    throw new Error(`наблюдение ${index + 1}: нет messageId`);
  }
  return observation as unknown as Observation;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === undefined) return "отсутствует";
  return String(value);
}

/** Имя файла экспорта проекта. */
export function projectFileName(captureName: string | null): string {
  const base = (captureName ?? "project").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${base.length > 0 ? base : "project"}.project.json`;
}

/** Имя файла экспорта модели — по названию модели. */
export function modelFileName(modelName: string): string {
  const base = modelName.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${base.length > 0 ? base : "model"}.json`;
}

/** Имя файла README модели — рядом с JSON. */
export function modelReadmeFileName(modelName: string): string {
  const base = modelName.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${base.length > 0 ? base : "model"}-README.md`;
}

/** Имя файла отчёта — по записи. */
export function reportFileName(captureName: string | null): string {
  const base = (captureName ?? "report").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return `${base.length > 0 ? base : "report"}.report.md`;
}
