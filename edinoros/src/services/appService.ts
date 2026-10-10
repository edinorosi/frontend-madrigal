import type {
  Capture,
  Direction,
  Message,
  Observation,
  Session,
} from "@/src/types/domain";

/**
 * Интерфейс доступа к данным (§12). Единственная граница между интерфейсом
 * и источником данных. Реализаций ровно одна — mockService; при подключении
 * бэкенда появляется вторая, интерфейс при этом не меняется.
 *
 * Отклонение от §12, согласованное отдельно: у `listMessages` параметр
 * `direction` сделан необязательным. Вызов без него возвращает сообщения
 * обеих сторон одним потоком — так работает единый список сообщений (§5),
 * а `direction` служит фильтром.
 */
export interface AppService {
  listCaptures(): Promise<Capture[]>;
  importCapture(file: File): Promise<Capture>;
  listSessions(captureId: string): Promise<Session[]>;
  listMessages(sessionId: string, direction?: Direction): Promise<Message[]>;

  /**
   * Байты записи. `offset` — смещение в байтовом потоке записи, то же,
   * что `Message.byteOffset`, поэтому байты сообщения читаются как
   * getBytes(captureId, message.byteOffset, message.length).
   */
  getBytes(
    captureId: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array>;

  saveObservation(obs: Observation): Promise<void>;
  /**
   * Удаление наблюдения. Отклонение от §12, согласованное отдельно:
   * без него раздел «карточка наблюдения» нечем закрыть.
   */
  removeObservation(id: string): Promise<void>;
  listObservations(messageId: string): Promise<Observation[]>;
}
