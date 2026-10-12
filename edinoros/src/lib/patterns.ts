/**
 * Распознавание популярных закономерностей кадров по уже загруженным
 * байтам сообщений — подсказка модели при импорте записи.
 *
 * Это НЕ парсинг PCAP (он за бэком): байты сообщений уже извлечены,
 * здесь ищутся повторяющиеся структуры — синхрослово, опкод, поле
 * длины, хвост. Результат — черновик модели в формате ModelRule,
 * который сразу применяется существующим applyModelToBytes.
 */
import { createId } from "@/src/lib/ids";
import type { Model, ModelField, ModelRule } from "@/src/types/domain";

/** Байты одного сообщения для анализа. */
export interface MessageSample {
  bytes: Uint8Array;
}

export type PatternKind = "sync" | "opcode" | "length" | "tail" | "text";

export interface PatternFinding {
  kind: PatternKind;
  /** Короткий заголовок для диалога. */
  title: string;
  /** Пояснение с процентами. */
  detail: string;
  /** Уверенность 0..1 (для порядка показа). */
  confidence: number;
}

export interface PatternSuggestion {
  findings: PatternFinding[];
  /** Черновик модели или null, если находок недостаточно. */
  model: Model | null;
}

/** Сколько сообщений анализировать. */
export const PATTERN_SAMPLE_LIMIT = 50;

/** Минимальная доля сообщений с общим синхрословом. */
const SYNC_MIN_RATE = 0.6;
/** Минимальная доля совпадений формулы длины. */
const LENGTH_MIN_RATE = 0.8;
/** Минимальная доля сообщений, покрытых списком опкодов. */
const OPCODE_MIN_COVERAGE = 0.7;
/** Максимум опкодов в условии правила. */
const MAX_OPCODES = 16;

function hexByte(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
}

/** Доля байтов, лежащих в печатном ASCII. */
function printableRate(samples: MessageSample[]): number {
  let total = 0;
  let printable = 0;
  for (const sample of samples) {
    for (const byte of sample.bytes) {
      total += 1;
      if (byte >= 0x20 && byte <= 0x7e) printable += 1;
    }
  }
  return total === 0 ? 0 : printable / total;
}

/**
 * Поиск структуры: возвращает находки и параметры для сборки модели.
 * Никогда не бросает — пустые данные дают пустую подсказку.
 */
export function analyzeCapture(
  samples: MessageSample[],
  captureName: string | null,
): PatternSuggestion {
  const usable = samples.filter((sample) => sample.bytes.length >= 2);
  if (usable.length === 0) return { findings: [], model: null };

  const findings: PatternFinding[] = [];

  /* ── 1. Синхрослово: одни и те же первые два байта ─────────────────── */
  const syncCounts = new Map<number, number>();
  for (const sample of usable) {
    const key = ((sample.bytes[0] << 8) | sample.bytes[1]) >>> 0;
    syncCounts.set(key, (syncCounts.get(key) ?? 0) + 1);
  }
  let syncKey = -1;
  let syncRate = 0;
  for (const [key, count] of syncCounts) {
    if (count / usable.length > syncRate) {
      syncKey = key;
      syncRate = count / usable.length;
    }
  }
  const hasSync = syncKey >= 0 && syncRate >= SYNC_MIN_RATE;
  if (hasSync) {
    findings.push({
      kind: "sync",
      title: `Синхрослово ${hexByte(syncKey >> 8)} ${hexByte(syncKey & 0xff)}`,
      detail: `В начале кадра у ${percent(syncRate)} сообщений`,
      confidence: syncRate,
    });
  }

  /* ── 2. Опкод: байт после синхрослова (или первый байт) ────────────── */
  const opcodeOffset = hasSync ? 2 : 0;
  const opcodeCounts = new Map<number, number>();
  for (const sample of usable) {
    if (sample.bytes.length <= opcodeOffset) continue;
    const value = sample.bytes[opcodeOffset];
    opcodeCounts.set(value, (opcodeCounts.get(value) ?? 0) + 1);
  }
  const minOpcodeCount = Math.max(2, Math.floor(usable.length * 0.05));
  const topOpcodes = [...opcodeCounts.entries()]
    .filter(([, count]) => count >= minOpcodeCount)
    .sort((a, b) => b[1] - a[1]);
  const opcodeCoverage =
    usable.length === 0
      ? 0
      : topOpcodes.reduce((sum, [, count]) => sum + count, 0) / usable.length;
  const opcodes =
    opcodeCoverage >= OPCODE_MIN_COVERAGE && topOpcodes.length <= MAX_OPCODES
      ? topOpcodes.map(([value]) => value).sort((a, b) => a - b)
      : null;
  if (opcodes !== null && opcodes.length > 0) {
    const shown = opcodes.slice(0, 8).map(hexByte).join(" ");
    findings.push({
      kind: "opcode",
      title: `Опкоды: ${shown}${opcodes.length > 8 ? " …" : ""}`,
      detail: `Список покрывает ${percent(opcodeCoverage)} сообщений`,
      confidence: opcodeCoverage,
    });
  }

  /* ── 3. Поле длины: u16be, равное остатку кадра ────────────────────── */
  // Формула A: значение = всё после поля; формула B: то же минус 2 байта
  // хвоста (классическая схема len + payload + crc16).
  interface LengthCandidate {
    offset: number;
    formula: "A" | "B";
    rate: number;
  }
  let bestLength: LengthCandidate | null = null;
  if (usable.length >= 5) {
    for (const offset of [1, 2, 3, 4]) {
      for (const formula of ["A", "B"] as const) {
        let hits = 0;
        let checked = 0;
        for (const sample of usable) {
          if (sample.bytes.length < offset + 2) continue;
          checked += 1;
          const tail = formula === "B" ? 4 : 2;
          const expected = sample.bytes.length - offset - tail;
          if (expected >= 0 && u16be(sample.bytes, offset) === expected) {
            hits += 1;
          }
        }
        const rate = checked === 0 ? 0 : hits / checked;
        if (
          rate >= LENGTH_MIN_RATE &&
          (bestLength === null || rate > bestLength.rate)
        ) {
          bestLength = { offset, formula, rate };
        }
      }
    }
  }
  if (bestLength !== null) {
    findings.push({
      kind: "length",
      title: `Поле длины: u16be @${bestLength.offset}`,
      detail:
        bestLength.formula === "B"
          ? `Равно длине payload (остаток кадра минус 2 байта хвоста) у ${percent(bestLength.rate)} сообщений`
          : `Равно остатку кадра у ${percent(bestLength.rate)} сообщений`,
      confidence: bestLength.rate,
    });
  }

  /* ── 4. Хвост: 2 байта после payload — кандидат в контрольную сумму ── */
  const hasTailByLength = bestLength?.formula === "B";
  let tailFinding: PatternFinding | null = null;
  if (hasSync && hasTailByLength) {
    const tailKeys = new Set<number>();
    for (const sample of usable) {
      const last = sample.bytes.length - 1;
      tailKeys.add(((sample.bytes[last - 1] << 8) | sample.bytes[last]) >>> 0);
    }
    tailFinding = {
      kind: "tail",
      title: "Хвост: 2 байта",
      detail:
        tailKeys.size > 1
          ? "Значения различаются — похоже на контрольную сумму"
          : "Постоянное значение — маркер конца кадра",
      confidence: 0.7,
    };
  }

  /* ── 5. Текст: печатный ASCII без явной структуры ──────────────────── */
  const printable = printableRate(usable);
  const textFinding: PatternFinding | null =
    !hasSync && printable >= 0.9
      ? {
          kind: "text",
          title: "Текстовые данные",
          detail: `${percent(printable)} байтов — печатный ASCII`,
          confidence: printable,
        }
      : null;

  if (textFinding) findings.push(textFinding);
  if (tailFinding) findings.push(tailFinding);

  const model = buildModel({
    captureName,
    hasSync,
    syncKey,
    opcodes,
    lengthField: bestLength,
    hasTail: hasTailByLength,
    samples: usable,
    opcodeOffset,
  });

  return { findings, model };
}

/* ── Сборка черновика модели ─────────────────────────────────────────── */

function field(
  name: string,
  type: string,
  offset: number | "end-2",
  length: number | "rest" | "rest-2",
  note?: string,
): ModelField {
  return note === undefined ? { name, type, offset, length } : { name, type, offset, length, note };
}

function buildModel(input: {
  captureName: string | null;
  hasSync: boolean;
  syncKey: number;
  opcodes: number[] | null;
  lengthField: { offset: number; formula: "A" | "B" } | null;
  hasTail: boolean;
  samples: MessageSample[];
  opcodeOffset: number;
}): Model | null {
  const { captureName, hasSync, syncKey, opcodes, lengthField, hasTail } =
    input;
  // Без синхрослова, опкода и длины описывать нечего — модель не строим.
  if (!hasSync && opcodes === null && lengthField === null) return null;

  const syncLength = hasSync ? 2 : 0;
  const headerEnd = Math.max(
    syncLength + (opcodes !== null ? 1 : 0),
    lengthField !== null ? lengthField.offset + 2 : 0,
    syncLength,
  );

  const headerFields: ModelField[] = [];
  if (hasSync) {
    headerFields.push(
      field("sync", "uint16be", 0, 2, `Синхрослово ${hexByte(syncKey >> 8)} ${hexByte(syncKey & 0xff)}`),
    );
  }
  if (opcodes !== null) {
    headerFields.push(
      field(
        "opcode",
        "uint8",
        input.opcodeOffset,
        1,
        `Опкод из списка: ${opcodes.slice(0, 8).map(hexByte).join(", ")}${opcodes.length > 8 ? " …" : ""}`,
      ),
    );
  }
  if (lengthField !== null) {
    headerFields.push(
      field(
        "length",
        "uint16be",
        lengthField.offset,
        2,
        lengthField.formula === "B"
          ? "Длина payload без учёта 2 байт хвоста"
          : "Длина остатка кадра",
      ),
    );
  }

  const payloadAndTail: ModelField[] = [];
  if (hasTail) {
    payloadAndTail.push(field("payload", "bytes", headerEnd, "rest-2"));
    payloadAndTail.push(
      field("crc16", "uint16be", "end-2", 2, "Хвост кадра — кандидат в контрольную сумму"),
    );
  } else if (headerEnd > 0) {
    payloadAndTail.push(field("payload", "bytes", headerEnd, "rest"));
  }

  const rules: ModelRule[] = [];

  // Правило с конкретными опкодами — основное.
  if (opcodes !== null && opcodes.length > 0) {
    rules.push({
      id: createId("rule"),
      name: "Распознанные опкоды",
      condition: { opcodes },
      fields: [...headerFields, ...payloadAndTail],
    });
    // Fallback: кадры с неизвестным опкодом всё равно разбираются по
    // синхрослову (как rule-unknown-opcode в дефолтной модели).
    rules.push({
      id: createId("rule"),
      name: "Неизвестный кадр",
      condition: {},
      fields: hasSync
        ? [
            field("sync", "uint16be", 0, 2),
            field("raw", "bytes", 2, "rest", "Хвост не описан моделью"),
          ]
        : [field("raw", "bytes", 0, "rest", "Кадр без распознанной структуры")],
    });
  } else {
    // Нет списка опкодов — единое правило на всю структуру.
    rules.push({
      id: createId("rule"),
      name: "Распознанная структура кадра",
      condition: {},
      fields: [...headerFields, ...payloadAndTail],
    });
  }

  // Короткие кадры не вмещают заголовок — отдельное правило с приоритетом.
  const shortSamples = input.samples.filter(
    (sample) => sample.bytes.length < headerEnd + 1,
  );
  if (hasSync && shortSamples.length > 0) {
    const maxShort = Math.max(
      ...shortSamples.map((sample) => sample.bytes.length),
    );
    rules.unshift({
      id: createId("rule"),
      name: "Короткий кадр",
      condition: { maxMessageLength: maxShort },
      fields: [
        field("sync", "uint16be", 0, 2),
        field("raw", "bytes", 2, "rest", "Хвост не описан моделью"),
      ],
    });
  }

  const name = captureName
    ? `Авто: ${captureName.replace(/\.(pcapng|pcap|cap)$/i, "")}`
    : "Авто: распознанные паттерны";

  return {
    id: createId("model"),
    name,
    status: "draft",
    rules,
    createdAt: new Date().toISOString(),
  };
}
