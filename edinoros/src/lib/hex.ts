import type { ByteRange } from "@/src/types/domain";

export const BYTES_PER_ROW = 16;

/** Смещение в классическом виде: 00000000. */
export function formatOffset(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(8, "0");
}

export function byteToHex(value: number | undefined): string {
  if (value === undefined) return "  ";
  return value.toString(16).toUpperCase().padStart(2, "0");
}

/** Печатный символ для колонки ASCII, иначе точка. */
export function byteToAscii(value: number | undefined): string {
  if (value === undefined) return " ";
  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : ".";
}

/** Диапазон по двум индексам включительно, независимо от порядка. */
export function rangeBetween(from: number, to: number): ByteRange {
  return from <= to
    ? { offset: from, length: to - from + 1 }
    : { offset: to, length: from - to + 1 };
}

export function rangeHasIndex(range: ByteRange | null, index: number): boolean {
  if (!range) return false;
  return index >= range.offset && index < range.offset + range.length;
}

/** Пересечение диапазонов — для подсветки поля под курсором. */
export function rangesIntersect(a: ByteRange, b: ByteRange): boolean {
  return a.offset < b.offset + b.length && b.offset < a.offset + a.length;
}

export function describeRange(range: ByteRange): string {
  const last = range.offset + range.length - 1;
  return range.length === 1
    ? `байт ${range.offset}`
    : `байты ${range.offset}–${last}`;
}

/** Байты в текст hex через пробел: «AA 55 01». Без range — весь массив. */
export function toHexText(bytes: Uint8Array, range?: ByteRange): string {
  const slice = range
    ? bytes.subarray(range.offset, range.offset + range.length)
    : bytes;
  return Array.from(slice, (value) =>
    value.toString(16).padStart(2, "0").toUpperCase(),
  ).join(" ");
}
