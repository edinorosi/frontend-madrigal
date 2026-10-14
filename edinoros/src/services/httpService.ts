/**
 * Реализация AppService поверх HTTP (бэкенд backend-madrigal, Axum, :8080).
 *
 * Выбирается в src/services/index.ts, когда задан NEXT_PUBLIC_API_URL.
 * Контракт AppService не меняется; ошибки кидаются как Error — их ловит
 * существующая обработка в сторе (describeError).
 */
import type { AppService } from "@/src/services/appService";
import type {
  Action,
  Capture,
  CheckResult,
  Direction,
  Message,
  MessageField,
  Model,
  Observation,
  Session,
} from "@/src/types/domain";

/** Ошибка HTTP-слоя: понятное сообщение для стора + код для диагностики. */
export class HttpServiceError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "HttpServiceError";
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

function requireBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) {
    throw new HttpServiceError(
      "NEXT_PUBLIC_API_URL не задан — httpService выбран без адреса бэкенда",
    );
  }
  return raw.trim().replace(/\/+$/, "");
}

/**
 * GET/POST/PUT/DELETE с таймаутом и разбором ошибок.
 * Бэк отвечает JSON; при 4xx/5xx поле «error» показывается как есть.
 * Кидаются HttpServiceError — их ловит describeError в сторе.
 */
export async function requestJson<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const baseUrl = requireBaseUrl();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...rest,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new HttpServiceError(
        `Бэкенд не ответил за ${timeoutMs} мс (${baseUrl})`,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new HttpServiceError(`Нет связи с бэкендом ${baseUrl}: ${detail}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "string"
      ) {
        detail = body.error;
      }
    } catch {
      // ответ не JSON — показываем статус
    }
    throw new HttpServiceError(
      detail
        ? `Бэкенд ${response.status}: ${detail}`
        : `Бэкенд вернул ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpServiceError("Бэкенд вернул некорректный JSON");
  }
}

/**
 * Метод AppService, для которого на бэке ещё нет роута в формате domain.ts.
 * expectedRoute — путь, который ждёт фронт (артефакт для бэкенд-разработчика).
 * Когда роут появится — заменить routeMissing на requestJson<T>(...).
 */
function routeMissing(method: string, expectedRoute: string): never {
  throw new HttpServiceError(
    `HTTP: метод ${method} не реализован на бэке — нужен ${expectedRoute}`,
  );
}

export const httpService: AppService = {
  async listCaptures() {
    routeMissing("listCaptures", "GET /api/v1/captures");
  },

  async importCapture(_file: File) {
    routeMissing("importCapture", "POST /api/v1/captures (multipart file)");
  },

  async listSessions(_captureId: string) {
    routeMissing("listSessions", "GET /api/v1/captures/:captureId/sessions");
  },

  async listMessages(_sessionId: string, _direction?: Direction) {
    routeMissing(
      "listMessages",
      "GET /api/v1/sessions/:sessionId/messages?direction=...",
    );
  },

  async getBytes(_captureId: string, _offset: number, _length: number) {
    routeMissing(
      "getBytes",
      "GET /api/v1/captures/:captureId/bytes?offset=&length= (application/octet-stream)",
    );
  },

  async saveObservation(_obs: Observation) {
    routeMissing(
      "saveObservation",
      "PUT /api/v1/observations (upsert по id, тело — Observation)",
    );
  },

  async removeObservation(_id: string) {
    routeMissing("removeObservation", "DELETE /api/v1/observations/:id");
  },

  async listObservations(_messageId: string) {
    routeMissing(
      "listObservations",
      "GET /api/v1/messages/:messageId/observations",
    );
  },

  async listActions(_captureId: string) {
    routeMissing("listActions", "GET /api/v1/captures/:captureId/actions");
  },

  async checkModel(_captureId: string, _modelId?: string) {
    routeMissing(
      "checkModel",
      "POST /api/v1/check (тело {captureId, modelId?}, ответ CheckResult)",
    );
  },

  async listModels() {
    routeMissing("listModels", "GET /api/v1/models");
  },

  async saveModel(_model: Model) {
    routeMissing("saveModel", "PUT /api/v1/models (upsert по id, тело — Model)");
  },

  async removeModel(_modelId: string) {
    routeMissing("removeModel", "DELETE /api/v1/models/:id");
  },

  async applyModel(_messageId: string, _modelId: string) {
    routeMissing(
      "applyModel",
      "POST /api/v1/messages/:messageId/apply-model (тело {modelId}, ответ MessageField[])",
    );
  },
};
