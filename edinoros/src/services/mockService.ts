/**
 * Реализация AppService на мок-данных (§12).
 * Данные лежат в src/mocks/*.json и сгенерированы scripts/generate-mock-data.mjs.
 *
 * Мок намеренно ведёт себя как сервер: асинхронно, с задержкой и с ошибками.
 * Байты отдаются по смещению в байтовом потоке записи — как их отдаст бэкенд.
 */
import actionsJson from "@/src/mocks/actions.json";
import capturesJson from "@/src/mocks/captures.json";
import messagesJson from "@/src/mocks/messages.json";
import modelsJson from "@/src/mocks/models.json";
import observationsJson from "@/src/mocks/observations.json";
import sessionsJson from "@/src/mocks/sessions.json";
import type { AppService } from "@/src/services/appService";
import { applyModelToBytes, type ApplyResult } from "@/src/lib/parse";
import { readMockSettings, recordImportedCapture } from "@/src/services/mock/scenarios";
import type {
  Action,
  Capture,
  CheckResult,
  CheckRow,
  Direction,
  Message,
  Model,
  Observation,
  Session,
} from "@/src/types/domain";

/** Сообщение в моке дополнительно несёт hex. В доменный тип Message он не входит. */
type MessageFixture = Message & { hex: string };

const captures = capturesJson as unknown as Capture[];
const sessions = sessionsJson as unknown as Session[];
const fixtures = messagesJson as unknown as MessageFixture[];

/**
 * Сообщения отдаются как Message[]: поле hex в доменном типе отсутствует,
 * поэтому интерфейс к нему не обратится и не завяжется на мок.
 * Реальные байты берутся только через getBytes.
 */
const messages: Message[] = fixtures;

let observations: Observation[] = [...(observationsJson as unknown as Observation[])];

/** Модели разбора (R3). Мутабельный массив — saveModel/removeModel меняют его. */
let models: Model[] = [...(modelsJson as unknown as Model[])];

/** Журнал действий оператора (R4). В моках он один на запись. */
const actions: Action[] = actionsJson as unknown as Action[];

const captureBytes = buildCaptureBytes(fixtures);

/**
 * Байты по записям: у каждой записи свой поток (контракт getBytes).
 * Базовой записи достаётся сгенерированный буфер; импортированные в моке
 * копируют его же — реального парсинга нет, но адресация уже по captureId.
 */
const captureBytesById = new Map<string, Uint8Array>(
  captures.map((capture) => [capture.id, captureBytes]),
);

// Записи, импортированные в прошлых сессиях (dev-мок держит их в
// localStorage): байты в моке одинаковые, но адресация по captureId
// должна работать и после перезагрузки страницы.
for (const imported of readMockSettings().importedCaptures) {
  captureBytesById.set(imported.id, captureBytes);
}

function buildCaptureBytes(items: MessageFixture[]): Uint8Array {
  const ordered = [...items].sort((a, b) => a.byteOffset - b.byteOffset);
  const total = ordered.reduce(
    (size, item) => Math.max(size, item.byteOffset + item.length),
    0,
  );

  const buffer = new Uint8Array(total);
  for (const item of ordered) {
    buffer.set(fromHex(item.hex), item.byteOffset);
  }
  return buffer;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Какие сессии видны в текущем сценарии.
 * captureId принимается, но не используется: в моке один набор сессий на всю запись.
 */
function visibleSessions(): Session[] {
  const { scenario } = readMockSettings();

  switch (scenario) {
    case "no-sessions":
      return [];
    case "single-message":
      return sessions.filter((session) => session.messageCount === 1);
    case "large":
      return sessions.filter((session) => session.messageCount > 100);
    default:
      return sessions;
  }
}

export const mockService: AppService = {
  async listCaptures() {
    const { scenario, latencyMs, importedCaptures } = readMockSettings();
    await delay(latencyMs);

    const base = scenario === "empty" ? [] : captures;
    return [...base, ...importedCaptures];
  },

  async importCapture(file: File) {
    const { importDurationMs, importFails } = readMockSettings();

    await delay(importDurationMs);

    if (importFails) {
      throw new Error(
        `Не удалось прочитать ${file.name}: запись повреждена или обрезана`,
      );
    }

    const imported: Capture = {
      id: `cap-imported-${Date.now()}`,
      fileName: file.name,
      importedAt: new Date().toISOString(),
      sizeBytes: file.size,
      sessionCount: sessions.length,
    };

    // Мок не парсит файл — импортированной записи достаётся тот же поток байтов.
    captureBytesById.set(imported.id, captureBytes);
    recordImportedCapture(imported);
    return imported;
  },

  /**
   * captureId принимается интерфейсом, но в моке не используется:
   * здесь один набор сессий на всю запись.
   */
  async listSessions() {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);
    return visibleSessions();
  },

  async listMessages(sessionId: string, direction?: Direction) {
    const { scenario, latencyMs } = readMockSettings();
    await delay(latencyMs);

    // DEV-сценарий: симуляция сбоя загрузки сообщений (баг С.7).
    if (scenario === "messages-fail") {
      throw new Error("Не удалось загрузить сообщения сессии");
    }

    // Контракт: без direction — обе стороны одним потоком, упорядоченным
    // по времени. Сортировка явная: порядок строк в JSON не договариваемость.
    return messages
      .filter(
        (message) =>
          message.sessionId === sessionId &&
          (direction === undefined || message.direction === direction),
      )
      .sort(
        (a, b) =>
          a.timestamp.localeCompare(b.timestamp) || a.byteOffset - b.byteOffset,
      );
  },

  async getBytes(captureId: string, offset: number, length: number) {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);

    const stream = captureBytesById.get(captureId);
    if (!stream) {
      throw new Error(`Запись ${captureId} не найдена`);
    }
    return stream.slice(offset, offset + length);
  },

  /** Upsert: совпадение по id означает правку, иначе добавление. */
  async saveObservation(obs: Observation) {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);

    const exists = observations.some((item) => item.id === obs.id);
    observations = exists
      ? observations.map((item) => (item.id === obs.id ? obs : item))
      : [...observations, obs];
  },

  async removeObservation(id: string) {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);
    observations = observations.filter((item) => item.id !== id);
  },

  async listObservations(messageId: string) {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);
    return observations.filter((item) => item.messageId === messageId);
  },

  async listActions(captureId: string) {
    const { scenario, latencyMs } = readMockSettings();
    await delay(latencyMs);
    // captureId нужен бэку; в моке журнал один на запись, а в сценарии
    // «empty» записей нет вообще — значит и журнала нет.
    if (scenario === "empty" || captureId === "") return [];
    return actions;
  },

  async checkModel(captureId: string, modelId?: string) {
    const { scenario, latencyMs } = readMockSettings();
    await delay(latencyMs);

    // Модель по id; без id — первая (так делал мок до R3-г).
    const model = modelId
      ? models.find((item) => item.id === modelId)
      : models[0];

    const journal = scenario === "empty" || captureId === "" ? [] : actions;
    const rows: CheckRow[] = journal.map((action, index) => {
      const rowId = `chk-${String(index + 1).padStart(3, "0")}`;
      const base = {
        id: rowId,
        actionId: action.id,
        time: action.timestamp,
        action: action.description,
        expected: action.value,
      };

      const message = action.expectedMessageId
        ? messages.find((item) => item.id === action.expectedMessageId)
        : undefined;

      if (!message) {
        return { ...base, extracted: "—", status: "unknown" as const, messageId: action.expectedMessageId };
      }

      // Модель не выбрана — извлекать нечего.
      if (!model) {
        return { ...base, extracted: "—", status: "unknown" as const, messageId: message.id };
      }

      // Применяем модель к байтам сообщения (R3-г): статус и поля — из модели,
      // а не из JSON-статуса сообщения.
      const stream = captureBytesById.get(captureId) ?? captureBytes;
      const bytes = stream.slice(
        message.byteOffset,
        message.byteOffset + message.length,
      );
      const apply = applyModelToBytes(bytes, model);

      if (apply.status === "not-parsed") {
        return { ...base, extracted: "—", status: "unknown" as const, messageId: message.id };
      }
      if (action.value === null) {
        // Действие без значения: кадр разобран — сопоставлять нечего.
        return { ...base, extracted: "—", status: "ok" as const, messageId: message.id };
      }

      const extracted = extractValueFromApply(apply, bytes);
      if (extracted === null) {
        // Кадр разобран, но значение из байт не извлечено — частичный разбор.
        return { ...base, extracted: "—", status: "partial" as const, messageId: message.id };
      }
      return {
        ...base,
        extracted: `0x${extracted.toString(16).toUpperCase().padStart(2, "0")} (${extracted})`,
        status: extracted === action.value ? ("ok" as const) : ("error" as const),
        messageId: message.id,
      };
    });

    const summary = {
      total: rows.length,
      ok: rows.filter((row) => row.status === "ok").length,
      partial: rows.filter((row) => row.status === "partial").length,
      unknown: rows.filter((row) => row.status === "unknown").length,
      error: rows.filter((row) => row.status === "error").length,
    };

    return {
      rows,
      summary,
      modelId: model?.id ?? null,
      modelName: model?.name ?? null,
    };
  },

  async listModels() {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);
    return models;
  },

  /** Upsert: совпадение по id означает правку, иначе добавление. */
  async saveModel(model: Model) {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);

    const exists = models.some((item) => item.id === model.id);
    models = exists
      ? models.map((item) => (item.id === model.id ? model : item))
      : [...models, model];
  },

  async removeModel(modelId: string) {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);
    models = models.filter((item) => item.id !== modelId);
  },

  /**
   * Заглушка R3-а: modelId принимается, но не применяется — поля берутся
   * готовыми из мока. Клиентский расчёт по правилам приходит в R3-б.
   */
  async applyModel(messageId: string) {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);

    const message = messages.find((item) => item.id === messageId);
    if (!message) throw new Error(`Сообщение ${messageId} не найдено`);
    return message.fields;
  },
};

/**
 * Извлечение значения из разобранной модели (R3-г): границы полей берутся
 * из applyModelToBytes (payload — из модели), опкод — из поля opcode.
 * SET_PARAM: u16be первых двух байт payload; WRITE_PARAM: второй байт payload.
 * Для прочих опкодов извлечение неизвестно — null, строка станет «не проверено».
 */
function extractValueFromApply(
  apply: ApplyResult,
  bytes: Uint8Array,
): number | null {
  const opcodeField = apply.fields.find((field) => field.name === "opcode");
  const payloadField = apply.fields.find((field) => field.name === "payload");
  if (!payloadField) return null;

  // Опкод — по границе поля модели; без неё — по смещению кадра.
  const opcodeOffset = opcodeField?.range.offset ?? 2;
  if (bytes.length <= opcodeOffset) return null;
  const opcode = bytes[opcodeOffset];

  const start = payloadField.range.offset;
  const payload = bytes.subarray(start, start + payloadField.range.length);
  if (payload.length < 2) return null;

  switch (opcode) {
    case 0x02:
      return (payload[0] << 8) | payload[1];
    case 0x04:
      return payload[1];
    default:
      return null;
  }
}
