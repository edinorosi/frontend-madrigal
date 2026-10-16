/**
 * Реализация AppService поверх HTTP (бэкенд backend-madrigal, Axum, :8080).
 *
 * Выбирается в src/services/index.ts, когда задан NEXT_PUBLIC_API_URL.
 * Контракт AppService не меняется; ошибки кидаются как Error — их ловит
 * существующая обработка в сторе (describeError).
 */
import type {
  AppService,
  CodegenLang,
  CodegenResult,
  ProjectArchiveImportResult,
  ProjectArchiveRequest,
} from "@/src/services/appService";
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

/**
 * Токен для замка бэкенда (env API_TOKEN там).
 * Без NEXT_PUBLIC_API_TOKEN — как раньше, без заголовка.
 */
function authHeaders(): Record<string, string> {
  const token = process.env.NEXT_PUBLIC_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function withAuth(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(authHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return { ...init, headers };
}

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
    response = await fetch(`${baseUrl}${path}`, withAuth({
      ...rest,
      signal: controller.signal,
    }));
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

async function requestBytes(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Uint8Array> {
  const baseUrl = requireBaseUrl();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, withAuth({
      ...rest,
      signal: controller.signal,
    }));
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
    throw new HttpServiceError(
      `Бэкенд вернул ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Текстовый ответ (бэкенд отдаёт Markdown отчёта как text/markdown, не JSON).
 * Семантика ошибок — как в requestJson.
 */
async function requestText(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<string> {
  const baseUrl = requireBaseUrl();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, withAuth({
      ...rest,
      signal: controller.signal,
    }));
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

  return response.text();
}

/**
 * Бинарный ответ (tar.gz архива проекта — application/gzip).
 */
async function requestBlob(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Uint8Array> {
  return requestBytes(path, init);
}

export const httpService: AppService = {
  async listCaptures() {
    return requestJson<Capture[]>(`/api/v1/captures`);
  },

  async importCapture(file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    return requestJson<Capture>(`/api/v1/captures`, {
      method: "POST",
      body: form,
    });
  },

  async listSessions(captureId: string) {
    return requestJson<Session[]>(
      `/api/v1/captures/${encodeURIComponent(captureId)}/sessions`,
    );
  },

  async listMessages(sessionId: string, direction?: Direction) {
    const q = direction ? `?direction=${encodeURIComponent(direction)}` : "";
    return requestJson<Message[]>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages${q}`,
    );
  },

  async getBytes(captureId: string, offset: number, length: number) {
    return requestBytes(
      `/api/v1/captures/${encodeURIComponent(captureId)}/bytes?offset=${offset}&length=${length}`,
    );
  },

  async saveObservation(obs: Observation) {
    await requestJson<void>(`/api/v1/observations`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(obs),
    });
  },

  async removeObservation(id: string) {
    await requestJson<void>(
      `/api/v1/observations/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  },

  async listObservations(messageId: string) {
    return requestJson<Observation[]>(
      `/api/v1/messages/${encodeURIComponent(messageId)}/observations`,
    );
  },

  async listActions(captureId: string) {
    return requestJson<Action[]>(
      `/api/v1/captures/${encodeURIComponent(captureId)}/actions`,
    );
  },

  async checkModel(captureId: string, modelId?: string) {
    return requestJson<CheckResult>(`/api/v1/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capture_id: captureId, model_id: modelId ?? null }),
    });
  },

  async listModels() {
    return requestJson<Model[]>(`/api/v1/models`);
  },

  async saveModel(model: Model) {
    await requestJson<void>(`/api/v1/models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(model),
    });
  },

  async removeModel(modelId: string) {
    await requestJson<void>(
      `/api/v1/models/${encodeURIComponent(modelId)}`,
      { method: "DELETE" },
    );
  },

  async applyModel(messageId: string, modelId: string) {
    return requestJson<MessageField[]>(
      `/api/v1/messages/${encodeURIComponent(messageId)}/apply-model`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId }),
      },
    );
  },

  async inferModel(captureId: string) {
    return requestJson<InferResult>(`/api/v1/analyze/fields`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capture_id: captureId }),
    });
  },

  async getModelCode(modelId: string, lang: CodegenLang) {
    return requestJson<CodegenResult>(
      `/api/v1/models/${encodeURIComponent(modelId)}/codegen?lang=${encodeURIComponent(lang)}`,
    );
  },

  async generateBackendReport(captureId: string, projectName: string) {
    return requestText(`/api/v1/report/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capture_id: captureId,
        project_name: projectName,
      }),
    });
  },

  async exportProjectArchive(args: ProjectArchiveRequest) {
    return requestBlob(`/api/v1/projects/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_name: args.projectName,
        rules: args.rules,
        files: args.files,
      }),
    });
  },

  async importProjectArchive(file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    return requestJson<ProjectArchiveImportResult>(
      `/api/v1/projects/import`,
      {
        method: "POST",
        body: form,
      },
    );
  },
};
