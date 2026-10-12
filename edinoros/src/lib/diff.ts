/**
 * Байтовое сравнение двух сообщений. Чистая функция: без UI, без сайд-эффектов.
 */
import type { ByteRange } from "@/src/types/domain";

export interface DiffByte {
  /** Смещение внутри сообщения. */
  offset: number;
  byteA: number;
  byteB: number;
}

export interface DiffTail {
  /** Какое сообщение длиннее. */
  longer: "A" | "B";
  /** С какого байта начинается хвост. */
  offsetStart: number;
  length: number;
}

export interface DiffResult {
  diffBytes: DiffByte[];
  tail: DiffTail | null;
  stats: {
    lengthA: number;
    lengthB: number;
    /** Число отличающихся байтов в общей части, без хвоста. */
    diffCount: number;
    firstDiffOffset: number | null;
  };
}

/**
 * Сравнивает сообщения побайтно в общей части; всё, что за её пределами, — хвост.
 * Хвост не разворачивается в отдельные байты: на сообщении в несколько КиБ
 * это тысячи записей ради одной и той же информации.
 *
 * Однослотовый кэш: HEX-маска и панель сравнения считают дифф на одних и тех же
 * байтах в одном рендере — второй вызов отдаёт прежний результат без перебора.
 * Функция чистая; изменение байтов на месте не предполагается.
 */
let lastA: Uint8Array | null = null;
let lastB: Uint8Array | null = null;
let lastResult: DiffResult | null = null;

export function computeDiff(bytesA: Uint8Array, bytesB: Uint8Array): DiffResult {
  if (lastA === bytesA && lastB === bytesB && lastResult !== null) {
    return lastResult;
  }

  const common = Math.min(bytesA.length, bytesB.length);
  const diffBytes: DiffByte[] = [];

  for (let offset = 0; offset < common; offset += 1) {
    const byteA = bytesA[offset];
    const byteB = bytesB[offset];
    if (byteA !== byteB) {
      diffBytes.push({ offset, byteA, byteB });
    }
  }

  let tail: DiffTail | null = null;
  if (bytesA.length !== bytesB.length) {
    const longer: DiffTail["longer"] = bytesA.length > bytesB.length ? "A" : "B";
    tail = {
      longer,
      offsetStart: common,
      length: Math.abs(bytesA.length - bytesB.length),
    };
  }

  const result: DiffResult = {
    diffBytes,
    tail,
    stats: {
      lengthA: bytesA.length,
      lengthB: bytesB.length,
      diffCount: diffBytes.length,
      firstDiffOffset: diffBytes.length > 0 ? diffBytes[0].offset : null,
    },
  };

  lastA = bytesA;
  lastB = bytesB;
  lastResult = result;
  return result;
}

/** Потолок отрезков для мини-карты: больше — склеиваем соседние. */
const MAX_MASK_RANGES = 256;

/**
 * Слитные отрезки маски: подряд идущие единицы — один отрезок.
 * Нужно мини-карте: рисовать 4096 отдельных меток вместо одного отрезка незачем.
 * При числе отрезков больше MAX_MASK_RANGES соседние склеиваются через зазор —
 * мини-карта остаётся обзором, а не точной картой.
 */
export function maskToRanges(mask: Uint8Array): ByteRange[] {
  const ranges: ByteRange[] = [];
  let start = -1;

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 1) {
      if (start === -1) start = index;
    } else if (start !== -1) {
      ranges.push({ offset: start, length: index - start });
      start = -1;
    }
  }

  if (start !== -1) {
    ranges.push({ offset: start, length: mask.length - start });
  }

  if (ranges.length <= MAX_MASK_RANGES) {
    return ranges;
  }

  // Склейка: каждые step отрезков схлопываются в один, покрывающий и зазор.
  const step = Math.ceil(ranges.length / MAX_MASK_RANGES);
  const merged: ByteRange[] = [];
  let current = { ...ranges[0] };
  for (let index = 1; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (index % step === 0) {
      merged.push(current);
      current = { ...range };
    } else {
      const end = range.offset + range.length;
      current = { offset: current.offset, length: end - current.offset };
    }
  }
  merged.push(current);
  return merged;
}
