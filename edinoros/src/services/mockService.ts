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
import observationsJson from "@/src/mocks/observations.json";
import sessionsJson from "@/src/mocks/sessions.json";
import type { AppService } from "@/src/services/appService";
import { readMockSettings, recordImportedCapture } from "@/src/services/mock/scenarios";
import type {
  Action,
  Capture,
  CheckResult,
  CheckRow,
  Direction,
  Message,
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

/** Журнал действий оператора (R4). В моках он один на запись. */
const actions: Action[] = actionsJson as unknown as Action[];

const captureBytes = buildCaptureBytes(fixtures);

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
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);

    return messages.filter(
      (message) =>
        message.sessionId === sessionId &&
        (direction === undefined || message.direction === direction),
    );
  },

  async getBytes(captureId: string, offset: number, length: number) {
    const { latencyMs } = readMockSettings();
    await delay(latencyMs);
    return captureBytes.slice(offset, offset + length);
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

  async checkModel(captureId: string) {
    // modelId: в моках одна модель, параметр берётся для будущего бэка.
    const { scenario, latencyMs } = readMockSettings();
    await delay(latencyMs);

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
      if (message.status !== "parsed") {
        return { ...base, extracted: "—", status: "unknown" as const, messageId: message.id };
      }
      if (action.value === null) {
        // Действие без значения: кадр разобран — сопоставлять нечего.
        return { ...base, extracted: "—", status: "ok" as const, messageId: message.id };
      }

      const extracted = extractValue(message);
      if (extracted === null) {
        return { ...base, extracted: "—", status: "unknown" as const, messageId: message.id };
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
      unknown: rows.filter((row) => row.status === "unknown").length,
      error: rows.filter((row) => row.status === "error").length,
    };

    return { rows, summary };
  },
};

/**
 * Извлечение значения из байт сообщения — мок имитирует работу модели на бэке.
 * Кадр: AA 55 | opcode(1) | length(2 BE) | payload | crc16(2 BE).
 * SET_PARAM: u16be первых двух байт payload; WRITE_PARAM: второй байт payload.
 * Для прочих опкодов извлечение неизвестно — null, строка станет «не проверено».
 */
function extractValue(message: Message): number | null {
  const bytes = captureBytes.slice(message.byteOffset, message.byteOffset + message.length);
  if (bytes.length < 5 || bytes[0] !== 0xaa || bytes[1] !== 0x55) return null;

  const opcode = bytes[2];
  const length = (bytes[3] << 8) | bytes[4];
  const payload = bytes.slice(5, 5 + length);
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
