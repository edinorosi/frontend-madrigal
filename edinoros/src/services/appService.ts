import type {
  Action,
  Capture,
  CheckResult,
  Direction,
  InferResult,
  Message,
  MessageField,
  Model,
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

  /**
   * Журнал действий оператора для записи (R4). Отклонение от §12,
   * согласованное отдельно: журнал — исходные данные исследования,
   * без него «Проверка» не имеет смысла.
   * TODO: реализация на бэке ожидается, мок готов.
   */
  listActions(captureId: string): Promise<Action[]>;
  /**
   * Прогон модели по журналу действий: извлекает значения из разобранных
   * сообщений и сопоставляет с журналом. `modelId` — пока необязательный,
   * в моках одна модель.
   * TODO: реализация на бэке ожидается, мок готов.
   */
  checkModel(captureId: string, modelId?: string): Promise<CheckResult>;

  /**
   * Модели разбора (R3). Отклонение от §12, согласованное отдельно:
   * модель — объект исследования, редактируется и сохраняется как сущность.
   * TODO: методы для R3. Согласованы с бэком. Ожидают реализации на бэке. Пока — моки.
   */
  listModels(): Promise<Model[]>;
  /** Сохранение модели: upsert по `id`. */
  saveModel(model: Model): Promise<void>;
  removeModel(modelId: string): Promise<void>;
  /**
   * Применение модели к сообщению: байты сообщения разбираются по правилам
   * модели, возвращаются поля с привязкой к байтам.
   * TODO: клиентский расчёт по правилам — R3-б. Пока возвращает готовые
   * поля сообщения из мока.
   */
  applyModel(messageId: string, modelId: string): Promise<MessageField[]>;
  /**
   * Автовывод модели из журнала действий: дифф сообщений с разными
   * параметрами, кластеризация по опкоду, поля с evidence совпадений.
   */
  inferModel(captureId: string): Promise<InferResult>;
}
