/**
 * Машиночитаемый формат экспорта модели разбора (R6.1).
 *
 * Формат нарочно отделён от доменного типа Model: это контракт обмена,
 * который читают внешние инструменты. Версия схемы позволяет отклонить
 * несовместимый файл при импорте, а не упасть на неожиданной структуре.
 */
import { createId } from "@/src/lib/ids";
import type {
  Model,
  ModelField,
  ModelRule,
  ModelStatus,
} from "@/src/types/domain";

/** Текущая версия схемы. Несовместимые версии отклоняются при импорте. */
export const MODEL_SCHEMA_VERSION = 1;

/** Конверт экспорта модели. */
export interface ModelExportFile {
  schemaVersion: typeof MODEL_SCHEMA_VERSION;
  metadata: {
    /** Когда выгружен файл, ISO 8601. */
    exportedAt: string;
    /** Автор; null — в приложении нет учётных записей. */
    author: string | null;
  };
  model: Model;
  /**
   * Источник: из какой записи исследовалась модель.
   * Только метаданные PCAP — само содержимое записи не выгружается.
   */
  source: {
    captureName: string | null;
    captureSizeBytes: number | null;
    captureImportedAt: string | null;
  };
}

/** Сборка конверта для скачивания. */
export function buildModelExport(
  model: Model,
  capture: { fileName: string; sizeBytes: number; importedAt: string } | null,
): ModelExportFile {
  return {
    schemaVersion: MODEL_SCHEMA_VERSION,
    metadata: {
      exportedAt: new Date().toISOString(),
      author: null,
    },
    model,
    source: {
      captureName: capture?.fileName ?? null,
      captureSizeBytes: capture?.sizeBytes ?? null,
      captureImportedAt: capture?.importedAt ?? null,
    },
  };
}

const MODEL_STATUSES: ModelStatus[] = ["draft", "checked", "stale"];

/**
 * Разбор и валидация файла модели. Бросает Error с русским сообщением —
 * его показывает пользователю кнопка экспорта.
 *
 * Идентификаторы правил и модели генерируются заново: импорт никогда не
 * перезаписывает существующие модели.
 */
export function parseModelExport(raw: string): Model {
  const file = parseJsonObject(raw, "файл модели");

  if (file.schemaVersion !== MODEL_SCHEMA_VERSION) {
    throw new Error(
      `Несовместимая версия схемы: ${describeValue(file.schemaVersion)} (ожидается ${MODEL_SCHEMA_VERSION})`,
    );
  }

  const model = asRecord(file.model, "в файле нет объекта model");
  const name = requireName(model.name, "у модели нет имени");

  const status: ModelStatus = MODEL_STATUSES.includes(
    model.status as ModelStatus,
  )
    ? (model.status as ModelStatus)
    : "draft";

  if (!Array.isArray(model.rules)) {
    throw new Error("у модели нет списка правил rules");
  }
  const rules = model.rules.map((rule, index) => parseRule(rule, index));

  const createdAt =
    typeof model.createdAt === "string" && model.createdAt.length > 0
      ? model.createdAt
      : new Date().toISOString();

  return { id: createId("model"), name, status, rules, createdAt };
}

/** Разбор одного правила; бросает Error с русским сообщением. */
export function parseRule(raw: unknown, index: number): ModelRule {
  const rule = asRecord(raw, `правило ${index + 1}: ожидался объект`);
  const name =
    typeof rule.name === "string" && rule.name.trim().length > 0
      ? rule.name.trim()
      : `Правило ${index + 1}`;

  const condition: ModelRule["condition"] = {};
  if (typeof rule.condition === "object" && rule.condition !== null) {
    const source = rule.condition as Record<string, unknown>;
    if (typeof source.opcode === "number") condition.opcode = source.opcode;
    if (Array.isArray(source.opcodes)) {
      const opcodes = source.opcodes.filter(
        (item): item is number => typeof item === "number",
      );
      if (opcodes.length > 0) condition.opcodes = opcodes;
    }
    if (typeof source.lengthEquals === "number") {
      condition.lengthEquals = source.lengthEquals;
    }
    if (typeof source.maxMessageLength === "number") {
      condition.maxMessageLength = source.maxMessageLength;
    }
  }

  if (!Array.isArray(rule.fields)) {
    throw new Error(`правило «${name}»: нет списка полей fields`);
  }
  const fields = rule.fields.map((field, fieldIndex) =>
    parseField(field, name, fieldIndex),
  );

  return { id: createId("rule"), name, condition, fields };
}

function parseField(
  raw: unknown,
  ruleName: string,
  index: number,
): ModelField {
  const field = asRecord(
    raw,
    `правило «${ruleName}», поле ${index + 1}: ожидался объект`,
  );
  const name = requireName(
    field.name,
    `правило «${ruleName}», поле ${index + 1}: нет имени`,
  );
  const type = requireName(field.type, `поле «${name}»: нет типа`);

  const offset = parseOffset(field.offset, `поле «${name}»`);
  const length = parseLength(field.length, `поле «${name}»`);
  const note = typeof field.note === "string" ? field.note : undefined;

  return { name, type, offset, length, note };
}

function parseOffset(value: unknown, where: string): ModelField["offset"] {
  if (value === "end-2") return "end-2";
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`${where}: offset должен быть числом или "end-2"`);
}

function parseLength(value: unknown, where: string): ModelField["length"] {
  if (value === "rest" || value === "rest-2") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new Error(`${where}: length должен быть числом, "rest" или "rest-2"`);
}

/* ── Общие помощники разбора ──────────────────────────────────────────── */

export function parseJsonObject(raw: string, what: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${what}: файл не является корректным JSON`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${what}: ожидался объект JSON`);
  }
  return data as Record<string, unknown>;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireName(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === undefined) return "отсутствует";
  return String(value);
}
