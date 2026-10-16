/**
 * Канонический реестр типов полей модели (фронтовое зеркало).
 *
 * Бэкенд-источник — `backend/api/src/field_types.rs`; при изменении
 * списка править оба места и текст `MODEL_HELP.fieldType`.
 * `observations.ts` держит ОТДЕЛЬНЫЙ список для наблюдений — не путать.
 */
export const FIELD_TYPES = [
  "uint8",
  "int8",
  "uint16be",
  "uint16le",
  "int16be",
  "int16le",
  "uint32be",
  "uint32le",
  "int32be",
  "int32le",
  "bytes",
  "string",
  "hex",
] as const;

export type FieldTypeId = (typeof FIELD_TYPES)[number];

const NUMERIC_RANGES: Record<string, { min: number; max: number }> = {
  uint8: { min: 0, max: 255 },
  int8: { min: -128, max: 127 },
  uint16be: { min: 0, max: 65535 },
  uint16le: { min: 0, max: 65535 },
  int16be: { min: -32768, max: 32767 },
  int16le: { min: -32768, max: 32767 },
  uint32be: { min: 0, max: 4294967295 },
  uint32le: { min: 0, max: 4294967295 },
  int32be: { min: -2147483648, max: 2147483647 },
  int32le: { min: -2147483648, max: 2147483647 },
};

export function isKnownFieldType(type: string): boolean {
  return (FIELD_TYPES as readonly string[]).includes(type);
}

function isHexPairs(text: string): boolean {
  const compact = text.split(/\s+/).join("");
  return compact.length > 0 && compact.length % 2 === 0 && /^[0-9a-f]+$/i.test(compact);
}

/**
 * Проверка textual `equals` кастомного условия под тип.
 * Семантика 1-в-1 как `parse_expected` на бэке; null — ошибка для формы.
 */
export function validateTermEquals(type: string, text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return "значение не может быть пустым";
  const range = NUMERIC_RANGES[type];
  if (range !== undefined) {
    let parsed: number;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) parsed = Number.parseInt(trimmed.slice(2), 16);
    else if (/^-?\d+$/.test(trimmed)) parsed = Number(trimmed);
    else return "число или 0x…";
    if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) {
      return `диапазон ${range.min}…${range.max}`;
    }
    return null;
  }
  if (type === "string") return null;
  if (type === "bytes" || type === "hex") {
    return isHexPairs(trimmed) ? null : "hex-пары, например AA 55";
  }
  return "неизвестный тип";
}
