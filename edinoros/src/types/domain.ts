/**
 * Доменные типы интерфейса.
 *
 * Фронт определяет форму данных, которую ждёт от сервиса (§12 — «типы методов»).
 * Бэкенд обязан отдавать ровно эти структуры.
 */

/** Направление сообщения: → запрос, ← ответ. */
export type Direction = "request" | "response";

/** Роль сообщения в обмене. */
export type MessageRole = "REQ" | "RSP" | "NOTIFY";

/** Результат применения модели разбора к сообщению. */
export type ParseStatus = "parsed" | "unknown" | "error";

/** Статус интерпретации сообщения. */
export type InterpretationStatus = "parsed" | "partial" | "not-parsed";

/** Статус гипотезы, привязанной к наблюдению. Устаревшее поле моков. */
export type HypothesisStatus = "confirmed" | "refuted" | "unchecked";

/** Статус наблюдения. */
export type ObservationStatus =
  | "draft"
  | "confirmed"
  | "refuted"
  | "stale";

/** Вид наблюдения. */
export type ObservationKind = "comment" | "range" | "hypothesis" | "field";

/** Диапазон байтов внутри сообщения. */
export interface ByteRange {
  offset: number;
  length: number;
}

export interface Endpoint {
  address: string;
  port: number;
}

/** Четвёрка адресов сессии. */
export interface SessionTuple {
  source: Endpoint;
  destination: Endpoint;
}

/**
 * Поле разобранного сообщения.
 * `range` — привязка к байтам: по ней ReferenceChip переходит к байтам в HEX.
 */
export interface MessageField {
  id: string;
  name: string;
  type: string;
  value: string;
  range: ByteRange;
  note?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  /** Номер пакета-источника в записи. */
  packetNumber: number;
  /** Смещение сообщения в байтовом потоке записи. */
  byteOffset: number;
  direction: Direction;
  role: MessageRole;
  /** Длина в байтах. */
  length: number;
  status: ParseStatus;
  /** Краткая метка для списка сообщений. */
  label: string;
  /** Время в формате ISO 8601. */
  timestamp: string;
  interpretation: InterpretationStatus;
  verified: boolean;
  /** Поля разбора. Пустой массив, если сообщение не разобрано. */
  fields: MessageField[];
}

export interface Session {
  id: string;
  captureId: string;
  tuple: SessionTuple;
  messageCount: number;
  startedAt: string;
}

export interface Capture {
  id: string;
  fileName: string;
  importedAt: string;
  sizeBytes: number;
  sessionCount: number;
}

/**
 * Наблюдение, привязанное к сообщению.
 *
 * `text` необязателен — наблюдение без комментария легально (§11).
 * `name` и `type` заполняются у наблюдений вида «field».
 * `status` необязателен: в моках его нет, там лежит устаревшее `hypothesis` —
 * см. resolveObservationStatus в src/lib/observations.ts.
 */
export interface Observation {
  id: string;
  messageId: string;
  kind: ObservationKind;
  text?: string;
  /** Имя поля — для наблюдений вида «field». */
  name?: string;
  /** Тип поля: u8, u16, u32, bytes, string. */
  type?: string;
  range?: ByteRange;
  status?: ObservationStatus;
  /** @deprecated устаревшее поле моков, читается только через resolveObservationStatus */
  hypothesis?: HypothesisStatus;
  createdAt: string;
}
