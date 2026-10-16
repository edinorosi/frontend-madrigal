/**
 * Применение модели через бэкенд с откатом на локальный парсер.
 *
 * Бэкенд (POST /messages/:id/apply-model) — источник истины: он же
 * персистит поля/статус/model_id в сообщение на сервере. Локальный
 * applyModelCached (src/lib/parse.ts) — зеркало для мок-режима и фолбэк,
 * а также для синхронного рендера (панели не могут ждать сеть на каждый кадр).
 *
 * Правило: в бэкенд-режиме bulk-пути (applyCapture, collectExportData,
 * привязка ruleId) идут через сервис; при любой ошибке — тихий откат
 * на локальный расчёт, чтобы UI не умирал из-за сети.
 */
import { appService, isBackendMode } from "@/src/services";
import { applyModelCached, type ApplyResult } from "@/src/lib/parse";
import type {
  ByteRange,
  MessageField,
  Model,
} from "@/src/types/domain";

/** Непокрытые полями диапазоны — то же правило, что в parse.ts: сортировка по смещению, пересечения не дырки. */
function gapsOf(fields: MessageField[], total: number): ByteRange[] {
  if (total <= 0) return [];
  const sorted = [...fields]
    .filter((field) => field.range.length > 0)
    .sort((a, b) => a.range.offset - b.range.offset);
  const gaps: ByteRange[] = [];
  let covered = 0;
  for (const field of sorted) {
    if (field.range.offset > covered) {
      gaps.push({ offset: covered, length: field.range.offset - covered });
    }
    covered = Math.max(covered, field.range.offset + field.range.length);
  }
  if (covered < total) {
    gaps.push({ offset: covered, length: total - covered });
  }
  return gaps;
}

/**
 * Поля бэкенда -> ApplyResult. ruleId/ruleName бэк не возвращает
 * (только поля) — кладём null; uncovered считаем по покрытию.
 */
export function fieldsToApplyResult(
  fields: MessageField[],
  total: number,
): ApplyResult {
  if (fields.length === 0) {
    return {
      fields: [],
      status: "not-parsed",
      ruleId: null,
      ruleName: null,
      uncovered: [],
    };
  }
  const uncovered = gapsOf(fields, total);
  return {
    fields,
    status: uncovered.length === 0 ? "parsed" : "partial",
    ruleId: fields[0]?.ruleId ?? null,
    ruleName: null,
    uncovered,
  };
}

/**
 * Разбор сообщения: в бэкенд-режиме — через POST apply-model
 * (сервер заодно сохраняет разбор), иначе/при ошибке — локально.
 */
export async function applyViaServiceOrLocal(
  messageId: string,
  bytes: Uint8Array,
  model: Model,
): Promise<ApplyResult> {
  if (!isBackendMode()) {
    return applyModelCached(messageId, bytes, model);
  }
  try {
    const fields = await appService.applyModel(messageId, model.id);
    return fieldsToApplyResult(fields, bytes.length);
  } catch {
    return applyModelCached(messageId, bytes, model);
  }
}
