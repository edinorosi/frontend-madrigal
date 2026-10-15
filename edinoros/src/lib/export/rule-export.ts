/**
 * Экспорт и импорт одного правила модели (JSON).
 *
 * Тот же контрактный подход, что у модели (model-export.ts): своя
 * версия схемы, валидация с русскими сообщениями, при импорте id
 * генерируется заново — правило никогда не перезаписывает существующие.
 */
import {
  MODEL_SCHEMA_VERSION,
  ImportFileError,
  parseJsonObject,
  parseRule,
} from "./model-export";
import { safeFileName } from "./download";
import type { ModelRule } from "@/src/types/domain";

/** Конверт экспорта правила. */
export interface RuleExportFile {
  schemaVersion: typeof MODEL_SCHEMA_VERSION;
  metadata: {
    /** Когда выгружен файл, ISO 8601. */
    exportedAt: string;
    author: string | null;
  };
  rule: ModelRule;
  /** Модель-источник: только имя, само правило от неё не зависит. */
  sourceModel: { id: string; name: string } | null;
}

/** Сборка конверта для скачивания. */
export function buildRuleExport(
  rule: ModelRule,
  sourceModel: { id: string; name: string } | null,
): RuleExportFile {
  return {
    schemaVersion: MODEL_SCHEMA_VERSION,
    metadata: {
      exportedAt: new Date().toISOString(),
      author: null,
    },
    rule,
    sourceModel,
  };
}

/**
 * Разбор и валидация файла правила. Бросает Error с русским сообщением —
 * его показывает пользователь. id правила при импорте генерируется новый.
 */
export function parseRuleExport(raw: string): ModelRule {
  const file = parseJsonObject(raw, "файл правила");

  if (!("schemaVersion" in file)) {
    throw new ImportFileError("файл правила: отсутствует поле schemaVersion");
  }
  if (file.schemaVersion !== MODEL_SCHEMA_VERSION) {
    const found =
      typeof file.schemaVersion === "string"
        ? `"${file.schemaVersion}"`
        : String(file.schemaVersion);
    throw new ImportFileError(
      `файл правила: несовместимая версия схемы: ${found} (ожидается ${MODEL_SCHEMA_VERSION})`,
    );
  }

  if ("model" in file && !("rule" in file)) {
    throw new ImportFileError(
      "файл правила: похоже, это файл модели. Используйте «Импорт модели» в меню «Экспорт»",
      "model-file",
    );
  }
  if (
    !("rule" in file) ||
    typeof file.rule !== "object" ||
    file.rule === null ||
    Array.isArray(file.rule)
  ) {
    throw new ImportFileError("файл правила: в файле нет объекта rule");
  }
  return parseRule(file.rule, 0);
}

/** Имя файла правила: безопасно для Windows и Linux. */
export function ruleFileName(rule: ModelRule): string {
  return `${safeFileName(rule.name.slice(0, 80))}.rule.json`;
}
