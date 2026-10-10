/**
 * Реализация AppService на мок-данных (§12).
 * Данные лежат в src/mocks/*.json и сгенерированы scripts/generate-mock-data.mjs.
 *
 * Мок намеренно ведёт себя как сервер: асинхронно, с задержкой и с ошибками.
 * Байты отдаются по смещению в байтовом потоке записи — как их отдаст бэкенд.
 */
import capturesJson from "@/src/mocks/captures.json";
import messagesJson from "@/src/mocks/messages.json";
import observationsJson from "@/src/mocks/observations.json";
import sessionsJson from "@/src/mocks/sessions.json";
import type { AppService } from "@/src/services/appService";
import { readMockSettings, recordImportedCapture } from "@/src/services/mock/scenarios";
import type {
  Capture,
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
};
