/**
 * Клиентский расчёт полей по модели разбора (R3-б).
 *
 * Чистые функции: ни стора, ни сервисов, ни сайд-эффектов.
 * Условия и смещения читаются по кадру AA 55 | opcode(1) | length(2 BE) |
 * payload | crc16(2 BE) — см. ModelRule в domain.ts.
 */
import type {
  MessageField,
  Model,
  ModelField,
  ModelRule,
} from "@/src/types/domain";

/** Итог применения модели к одному сообщению. */
export interface ApplyResult {
  fields: MessageField[];
  /** parsed — байты покрыты полями; partial — есть непокрытый хвост; not-parsed — ни одно правило не подошло. */
  status: "parsed" | "partial" | "not-parsed";
  ruleId: string | null;
  ruleName: string | null;
}

const NOT_PARSED: ApplyResult = {
  fields: [],
  status: "not-parsed",
  ruleId: null,
  ruleName: null,
};

/** Опкод кадра: байт смещения 2, если кадр достаточно длинный. */
function readOpcode(bytes: Uint8Array): number | null {
  return bytes.length > 2 ? bytes[2] : null;
}

/** Длина payload: u16be по смещению 3, если кадр достаточно длинный. */
function readLengthField(bytes: Uint8Array): number | null {
  return bytes.length > 4 ? ((bytes[3] << 8) | bytes[4]) : null;
}

/**
 * Условие правила: все заданные поля AND-ятся, пустое {} — всегда истина.
 * Если условие читать не из чего (кадр короче нужного) — ложь.
 */
function ruleMatches(bytes: Uint8Array, condition: ModelRule["condition"]): boolean {
  if (condition.maxMessageLength !== undefined && bytes.length > condition.maxMessageLength) {
    return false;
  }

  if (condition.opcode !== undefined || condition.opcodes !== undefined) {
    const opcode = readOpcode(bytes);
    if (opcode === null) return false;
    if (condition.opcode !== undefined && opcode !== condition.opcode) return false;
    if (condition.opcodes !== undefined && !condition.opcodes.includes(opcode)) return false;
  }

  if (condition.lengthEquals !== undefined) {
    const length = readLengthField(bytes);
    if (length === null || length !== condition.lengthEquals) return false;
  }

  return true;
}

/** Смещение поля: "end-2" — предпоследние 2 байта (crc16). */
function resolveOffset(offset: ModelField["offset"], total: number): number {
  return offset === "end-2" ? total - 2 : offset;
}

/** Длина поля: "rest" — до конца, "rest-2" — до конца минус crc16. */
function resolveLength(
  length: ModelField["length"],
  offset: number,
  total: number,
): number {
  if (length === "rest") return total - offset;
  if (length === "rest-2") return total - offset - 2;
  return length;
}

/** Строковое представление значения по типу поля. */
function formatValue(bytes: Uint8Array, offset: number, length: number, type: string): string {
  const slice = bytes.subarray(offset, offset + length);

  switch (type) {
    case "uint8": {
      if (slice.length < 1) return "—";
      return `0x${slice[0].toString(16).toUpperCase().padStart(2, "0")}`;
    }
    case "uint16be": {
      if (slice.length < 2) return "—";
      const value = (slice[0] << 8) | slice[1];
      return `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
    }
    case "uint32be": {
      if (slice.length < 4) return "—";
      const value = ((slice[0] << 24) | (slice[1] << 16) | (slice[2] << 8) | slice[3]) >>> 0;
      return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
    }
    case "string": {
      let out = "";
      for (const byte of slice) {
        out += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "·";
      }
      return out;
    }
    case "bytes":
    default:
      return `${length} Б`;
  }
}

/**
 * Байты сообщения покрыты полями: нет дыр между полями и нет хвоста.
 * Поля сортируются по смещению; наложение полей допустимо.
 */
function coversAllBytes(fields: MessageField[], total: number): boolean {
  if (total === 0) return true;

  const sorted = [...fields].sort((a, b) => a.range.offset - b.range.offset);
  let covered = 0;

  for (const field of sorted) {
    if (field.range.offset > covered) return false;
    covered = Math.max(covered, field.range.offset + field.range.length);
  }

  return covered >= total;
}

/**
 * Применение модели к байтам сообщения.
 *
 * Правила проверяются по порядку, побеждает первое совпавшее (R3-а).
 * Поле с вычисленным диапазоном за пределами сообщения пропускается —
 * кадр короче, чем описывает правило.
 */
export function applyModelToBytes(bytes: Uint8Array, model: Model): ApplyResult {
  const rule = model.rules.find((item) => ruleMatches(bytes, item.condition));
  if (!rule) return NOT_PARSED;

  const fields: MessageField[] = [];

  for (const modelField of rule.fields) {
    const offset = resolveOffset(modelField.offset, bytes.length);
    const length = resolveLength(modelField.length, offset, bytes.length);

    if (offset < 0 || length < 0 || offset + length > bytes.length) continue;

    fields.push({
      id: `${rule.id}-f-${modelField.name}`,
      name: modelField.name,
      type: modelField.type,
      value: formatValue(bytes, offset, length, modelField.type),
      range: { offset, length },
      note: modelField.note,
      ruleId: rule.id,
    });
  }

  return {
    fields,
    status: coversAllBytes(fields, bytes.length) ? "parsed" : "partial",
    ruleId: rule.id,
    ruleName: rule.name,
  };
}

/**
 * Кэш клиентского разбора: ключ `${messageId}:${modelId}`.
 * Модель неизменяема между правками — кэш сбрасывается в saveModel/removeModel.
 */
const applyCache = new Map<string, ApplyResult>();

/** Разбор с кэшем — для рендера: не пересчитывает при каждом вызове. */
export function applyModelCached(
  messageId: string,
  bytes: Uint8Array,
  model: Model,
): ApplyResult {
  const key = `${messageId}:${model.id}`;
  const hit = applyCache.get(key);
  if (hit) return hit;

  const result = applyModelToBytes(bytes, model);
  applyCache.set(key, result);
  return result;
}

/** Очистка кэша: всей карты или только результатов одной модели. */
export function invalidateApplyCache(modelId?: string): void {
  if (modelId === undefined) {
    applyCache.clear();
    return;
  }

  for (const key of [...applyCache.keys()]) {
    if (key.endsWith(`:${modelId}`)) applyCache.delete(key);
  }
}
