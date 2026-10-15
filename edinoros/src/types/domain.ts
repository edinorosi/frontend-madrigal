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
export type ParseStatus = "parsed" | "partial" | "unknown" | "error";

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
 * `ruleId` заполняется при клиентском разборе (R3-б) — какое правило модели
 * создало поле. В полях из JSON его нет.
 */
export interface MessageField {
  id: string;
  name: string;
  type: string;
  value: string;
  range: ByteRange;
  note?: string;
  ruleId?: string;
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
  /**
   * Модель разбора сообщения (R10.1). Необязательна: отсутствие — сообщение
   * разбирается активной моделью проекта. Согласовано с бэком: бэк хранит
   * и возвращает поле как есть.
   */
  modelId?: string;
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
  /**
   * Правило модели, на котором основано наблюдение (R9.2, согласовано с бэком).
   * Заполняется автоматически, если выделение попадает в поле правила;
   * отсутствует — основания на правило нет. Бэк хранит поле как есть.
   */
  ruleId?: string;
  createdAt: string;
}

/**
 * Действие оператора из журнала кейса (R4).
 * Журнал — исходные данные исследования: условия эксперимента.
 */
export interface Action {
  id: string;
  /** Время действия в журнале, "HH:MM:SS". */
  timestamp: string;
  /** Код действия: SET_PARAM, READ_PARAM, GET_MEASURE. */
  name: string;
  /** Человекочитаемое описание: «Установить 25°C». */
  description: string;
  /** Заданное значение, если действие его устанавливает. */
  value: number | null;
  /** Связанное сообщение обмена, если журнал его знает. */
  expectedMessageId: string | null;
}

/** Итог строки проверки модели. */
export type CheckStatus = "ok" | "partial" | "unknown" | "error";

/** Строка проверки: одно действие журнала сопоставлено с разбором. */
export interface CheckRow {
  id: string;
  actionId: string;
  time: string;
  action: string;
  /**
   * Ожидаемое значение из журнала (Action.value) — колонка «Ожидалось».
   * null — действию значение не задано.
   */
  expected: number | null;
  /** Что извлекла модель: «0x19 (25)» — колонка «Извлечено». */
  extracted: string;
  status: CheckStatus;
  messageId: string | null;
}

/** Результат прогона модели по журналу действий. */
export interface CheckResult {
  rows: CheckRow[];
  summary: {
    total: number;
    ok: number;
    /** Кадр разобран, но значение из байт не извлечено. */
    partial: number;
    unknown: number;
    error: number;
  };
  /** Модель, которой выполнен прогон (R3-г). null — модель не была выбрана. */
  modelId?: string | null;
  modelName?: string | null;
}

/* ── Модель разбора (R3) ──────────────────────────────────────────────── */

/** Статус модели разбора. */
export type ModelStatus = "draft" | "checked" | "stale";

/**
 * Поле, которое правило извлекает из кадра.
 *
 * `offset` — смещение от начала сообщения; "end-2" — предпоследние два байта
 * (контрольная сумма в кадре AA 55 | opcode | length | payload | crc16).
 * `length` — число байт; "rest" — до конца сообщения; "rest-2" — до конца
 * минус два байта (payload не включает crc16).
 */
export interface ModelField {
  name: string;
  /** uint8, uint16be, uint32be, bytes, string. */
  type: string;
  offset: number | "end-2";
  length: number | "rest" | "rest-2";
  note?: string;
}

/**
 * Правило разбора: применяется к сообщению, если выполнены все заданные
 * условия. Правила проверяются по порядку, побеждает первое совпавшее;
 * пустое условие — fallback для неразобранных кадров.
 *
 * Условия читаются по кадру AA 55 | opcode(1) | length(2 BE) | payload | crc16:
 * opcode — байт смещения 2, length — u16be по смещению 3.
 */
export interface ModelRule {
  id: string;
  name: string;
  condition: {
    /** Опкод равен. */
    opcode?: number;
    /** Опкод в списке — для группировки одинаковых кадров. */
    opcodes?: number[];
    /** Значение length-поля равно. */
    lengthEquals?: number;
    /** Сообщение не длиннее N байт — короткий или оборванный кадр. */
    maxMessageLength?: number;
    /** Точная длина сообщения в байтах — различает правила с одним опкодом. */
    messageLength?: number;
  };
  fields: ModelField[];
}

/** Модель разбора (R3). */
export interface Model {
  id: string;
  name: string;
  status: ModelStatus;
  rules: ModelRule[];
  createdAt: string;
}

/** Одно найденное поле при автовыводе модели (бэкенд /analyze/fields). */
export interface InferEvidenceField {
  name: string;
  offset: number;
  length: number;
  type: string;
  matches: number;
  total: number;
}

/** Один кластер автовывода: messages одной длины и опкода. */
export interface InferEvidenceRule {
  rule_id: string;
  opcode: number | null;
  msg_len: number;
  samples: number;
  labeled: number;
  fields: InferEvidenceField[];
}

/** Результат автовывода модели из журнала действий. */
export interface InferResult {
  model: Model;
  evidence: InferEvidenceRule[];
  framing_used: string;
  samples: number;
  labeled: number;
  clusters: number;
}
