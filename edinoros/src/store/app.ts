/**
 * Состояние приложения.
 *
 * Работа с данными — только через appService (§16: не смешивать UI и данные).
 * Стор не знает ни о моках, ни о сценариях: при подключении бэкенда этот файл
 * не меняется.
 */
import { create } from "zustand";
import { appService } from "@/src/services";
import { resolveMessageModel } from "@/src/lib/message-model";
import { invalidateApplyCache } from "@/src/lib/parse";
import { applyViaServiceOrLocal } from "@/src/lib/apply";
import { resolveObservationStatus } from "@/src/lib/observations";
import { parseModelExport } from "@/src/lib/export/model-export";
import { emptyProjectData, snapshotCaptureIds } from "@/src/lib/projects";
import {
  parseProjectExport,
  type ProjectExportFile,
} from "@/src/lib/export/project-export";
import {
  analyzeCapture,
  PATTERN_SAMPLE_LIMIT,
  type MessageSample,
  type PatternSuggestion,
} from "@/src/lib/patterns";
import type { ApplySummary, ExportData } from "@/src/lib/export/report";
import type {
  ByteRange,
  Capture,
  CheckResult,
  CheckRow,
  CheckStatus,
  Direction,
  InferResult,
  Message,
  Model,
  Observation,
  ParseStatus,
  Session,
} from "@/src/types/domain";

export type SidebarTab = "sessions" | "messages";
export type ImportPhase = "idle" | "running" | "done" | "error";
export type LoadingKey =
  | "captures"
  | "sessions"
  | "messages"
  | "bytes"
  | "observations";

/** Откуда брать поля активного сообщения: из JSON или расчитывать моделью. */
export type FieldsSource = "json" | "model";

/**
 * Фильтры списка сообщений. Живут в сторе, а не в состоянии компонента:
 * смена таба сайдбара размонтирует список, и фильтры/скролл не должны
 * теряться. "anomaly" — всё кроме «разобрано»: частично, неизвестно,
 * ошибка (счётчик аномалий
 * в статусбаре).
 */
export interface MessageFilter {
  query: string;
  direction: "all" | Direction;
  status: "all" | "anomaly" | ParseStatus;
}

/**
 * Фильтры таблицы проверок. Как и фильтры сообщений — в сторе:
 * панель проверки сворачивается, фильтры не должны теряться.
 */
export interface CheckFilter {
  /** Поиск по действию, времени, «Ожидалось», «Извлечено». */
  query: string;
  status: "all" | CheckStatus;
}

/** Фильтр проверок по умолчанию. */
export const DEFAULT_CHECK_FILTER: CheckFilter = { query: "", status: "all" };

/** Предупреждение об устаревании (R9.2). */
export interface StaleWarningState {
  /** Имена изменённых правил, у которых нашлись наблюдения. */
  ruleNames: string[];
  /** Короткие подписи наблюдений для списка. */
  items: string[];
  /** Сколько наблюдений затронуто. */
  count: number;
  /** Сами наблюдения — для отметки «устарели». */
  observations: Observation[];
}

const NO_LOADING: Record<LoadingKey, boolean> = {
  captures: false,
  sessions: false,
  messages: false,
  bytes: false,
  observations: false,
};

interface AppState {
  captures: Capture[];
  activeCaptureId: string | null;
  /**
   * Скоуп записей проекта: какие id из глобального списка бэкенда
   * принадлежат открытому проекту. null — скоупа нет (до первого
   * открытия). Дропдаун записей и проверка видят только скоуп.
   */
  projectCaptureIds: string[] | null;

  sessions: Session[];
  activeSessionId: string | null;

  messages: Message[];
  activeMessageId: string | null;
  /** Ошибка загрузки сообщений текущей сессии — блок «Повторить» в списке. */
  messagesError: string | null;

  bytes: Uint8Array | null;
  /** Ошибка загрузки байтов активного сообщения — блок «Повторить» в HEX. */
  bytesError: string | null;
  observations: Observation[];

  /** Текущее выделение байтов в HEX. */
  selection: ByteRange | null;
  /** Поле, наведённое в интерпретации, — подсвечивается в HEX. */
  hoveredFieldId: string | null;

  /** Второе сообщение для сравнения. null — сравнение не активно. */
  compareMessageId: string | null;
  /** Сообщение, с которым сравнение не удалось начать, — для «Повторить». */
  compareAttemptId: string | null;
  compareError: string | null;
  /** Байты второго сообщения. */
  compareBytes: Uint8Array | null;
  compareBytesLoading: boolean;
  compareBytesError: string | null;

  /** Панель «Проверка» (R4) открыта. */
  checkOpen: boolean;
  checkResult: CheckResult | null;
  checkLoading: boolean;
  checkError: string | null;
  /**
   * Записи, которые не удалось проверить при агрегации (R4.2).
   * Предупреждение над таблицей; общий результат при этом остаётся.
   */
  checkWarnings: string[] | null;
  /**
   * Записи, участвующие в проверке (R4.2). null — все записи.
   * Смена выбора сбрасывает результат и покрытие опкодов.
   */
  checkCaptureIds: string[] | null;
  /** Выбор записей для проверки; null — вернуть «все записи». */
  setCheckCaptureIds: (ids: string[] | null) => void;
  /** Фильтры таблицы проверок (поиск + статус). */
  checkFilter: CheckFilter;
  /** Частичное обновление фильтров проверки. */
  setCheckFilter: (patch: Partial<CheckFilter>) => void;
  /** Сброс фильтров проверки. */
  resetCheckFilter: () => void;
  /**
   * Покрытие опкодов (R4.2): какие опкоды есть в правилах модели
   * (covered) и какие реально встречены в выбранных записях (seen).
   */
  checkCoverage: { covered: number[]; seen: number[] } | null;
  /** Ключ последнего расчёта покрытия (модель + выбор) — защита от гонок. */
  checkCoverageKey: string | null;
  checkCoverageLoading: boolean;
  checkCoverageError: string | null;
  /** Сбор покрытия опкодов по выбранным записям; кэшируется по ключу. */
  loadCheckCoverage: () => Promise<void>;
  /**
   * Действий в журнале текущей записи. null — ещё не известно.
   * Кнопка «Проверка» рендерится только при журнале > 0.
   */
  journalCount: number | null;

  /** Модели разбора (R3). null — ещё не загружены. */
  models: Model[] | null;
  /** Активная модель; null — активной нет. */
  activeModelId: string | null;
  /**
   * Привязки сообщений к моделям (R10.1): messageId → modelId. Явный выбор
   * пользователя поверх активной модели проекта; сообщение без записи в
   * карте разбирается активной моделью. Карта живёт отдельно от сообщений:
   * список сообщений перезагружается из сервиса при каждой смене сессии.
   */
  messageModels: Record<string, string>;
  /** Назначить модели сообщение; null — вернуться к активной модели проекта. */
  setMessageModel: (messageId: string, modelId: string | null) => void;
  modelsLoading: boolean;

  /**
   * Редактор модели (R3-в) открыт — полноэкранный экран заменяет рабочую
   * зону. Состояние, а не роут: статический экспорт не требует маршрута,
   * Esc и возврат «Назад» не нуждаются в истории браузера.
   */
  modelEditorOpen: boolean;
  openModelEditor: () => void;
  closeModelEditor: () => void;

  /**
   * Предупреждение об устаревании наблюдений (R9.2): правила изменились
   * при закрытии редактора — возможно, наблюдения устарели. null — нет.
   * Статусы не гасятся автоматически — только предложение в диалоге.
   */
  staleWarning: StaleWarningState | null;
  /** Отметить перечисленные в предупреждении наблюдения устаревшими. */
  markStaleWarningObservations: () => Promise<void>;
  /** Закрыть предупреждение без изменений. */
  dismissStaleWarning: () => void;
  /**
   * Скан активной записи: наблюдения, связанные с изменёнными правилами
   * и не помеченные устаревшими. Вызывается при закрытии редактора.
   */
  checkStaleObservations: (
    ruleIds: string[],
    ruleNames: Map<string, string>,
  ) => Promise<void>;

  /**
   * Применение активной модели ко всей записи (R3-г): прогресс обхода
   * сообщений. null — не идёт.
   */
  applyCaptureProgress: { done: number; total: number } | null;
  /** Итог последнего применения модели ко всей записи. */
  applyCaptureSummary: {
    total: number;
    parsed: number;
    partial: number;
    notParsed: number;
  } | null;
  applyCaptureError: string | null;
  applyCapture: () => Promise<void>;
  /** Отмена идущего «Применить к записи»: гасит токен и убирает прогресс. */
  cancelApply: () => void;

  /** Откуда брать поля активного сообщения: из JSON или расчитывать моделью. */
  fieldsSource: FieldsSource;
  /** Переключатель источника полей в панели интерпретации. */
  setFieldsSource: (source: FieldsSource) => void;
  /** Очистка кэша клиентского разбора — при правке или удалении модели. */
  invalidateModelFields: (modelId?: string) => void;

  /** Портальный слой Radix (Select, Popover) открыт — Esc адресован ему. */
  overlayOpen: boolean;

  /**
   * Тик для заглушки «показать в пакете»: work-area ловит изменение
   * и подсвечивает ссылку на пакет в шапке.
   */
  sourcePulseTick: number;

  sidebarTab: SidebarTab;
  sidebarCollapsed: boolean;

  /** Фильтры списка сообщений — переживают смену таба сайдбара. */
  messageFilter: MessageFilter;
  /** Просьба фокусировать поле фильтра сообщений (Ctrl+F). */
  messageFilterFocusTick: number;

  loading: Record<LoadingKey, boolean>;
  error: string | null;

  importPhase: ImportPhase;
  /** 0…1. Прогресс импорта; заполняется тем, кто умеет его сообщать. */
  importProgress: number;
  importError: string | null;

  /**
   * Авто-паттерны: находки по байтам активной записи и черновик модели.
   * Не null — открыт диалог предложения (после импорта или вручную).
   */
  patternSuggestion: PatternSuggestion | null;
  patternLoading: boolean;
  /** Анализ байтов активной записи; true — есть что показать. */
  analyzePatterns: () => Promise<boolean>;
  /** Создать предложенную модель и сделать её активной. */
  acceptPatternSuggestion: () => Promise<void>;
  /** Отклонить предложение (и отменить идущий анализ). */
  dismissPatternSuggestion: () => void;
  /** Автовывод модели из журнала: результат, загрузка, ошибка. */
  inferResult: InferResult | null;
  inferLoading: boolean;
  inferError: string | null;
  /** Запустить автовывод по активной записи; true — есть что показать. */
  inferModelFromJournal: () => Promise<boolean>;
  /** Сохранить выведенную модель и сделать её активной. */
  acceptInferModel: () => Promise<void>;
  /** Закрыть диалог автовывода. */
  dismissInferModel: () => void;

  loadProject: (selectFirst?: boolean) => Promise<Capture[]>;
  selectCapture: (captureId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  selectMessage: (messageId: string) => Promise<void>;
  /** Upsert: сохранение с существующим id правит наблюдение, иначе создаёт. */
  saveObservation: (observation: Observation) => Promise<void>;
  removeObservation: (observationId: string) => Promise<void>;
  startCompare: (messageId: string) => Promise<void>;
  stopCompare: () => void;
  openCheck: () => Promise<void>;
  closeCheck: () => void;
  runCheck: () => Promise<void>;
  /** Отмена идущей проверки: гасит токен и убирает индикатор загрузки. */
  cancelCheck: () => void;
  /** Загрузка моделей разбора (R3). Сбой не роняет просмотр записи. */
  loadModels: () => Promise<void>;
  /** Выбор активной модели; null — сбросить выбор. */
  setActiveModel: (modelId: string | null) => void;
  /** Upsert: сохранение модели с существующим id правит её, иначе создаёт. */
  saveModel: (model: Model) => Promise<void>;
  removeModel: (modelId: string) => Promise<void>;
  /**
   * Переход к байтам сообщения из строки «Проверки». Если сообщение в другой
   * сессии — сначала переключает на неё.
   */
  gotoMessage: (messageId: string) => Promise<void>;
  setOverlayOpen: (open: boolean) => void;
  /** Заглушка «показать в пакете»: пульс ссылки в шапке work-area. */
  pulseSource: () => void;
  /** Байты сообщения по id — для копирования из ПКМ sidebar. */
  getMessageBytes: (messageId: string) => Promise<Uint8Array>;
  setSelection: (range: ByteRange | null) => void;
  setHoveredField: (fieldId: string | null) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  /** Явная установка состояния сайдбара (автосвёрт на узких экранах). */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Частичное обновление фильтров сообщений. */
  setMessageFilter: (patch: Partial<MessageFilter>) => void;
  /** Сброс фильтров сообщений в значения по умолчанию. */
  resetMessageFilter: () => void;
  /** Фокус на поле фильтра сообщений (тик — сообщение для списка). */
  focusMessageFilter: () => void;
  /**
   * Переход к смещению внутри активного сообщения (поле в статусбаре).
   * Смещение зажимается в длину сообщения; само прокручивание дампа
   * делает HEX-дамп по изменению selection.
   */
  gotoOffset: (offset: number) => void;
  startImport: (file: File) => Promise<void>;
  setImportProgress: (value: number) => void;
  cancelImport: () => void;
  dismissImportError: () => void;
  resetProject: () => void;

  /* ── Экспорт/импорт (R6) ─────────────────────────────────────────── */
  /**
   * Сбор полного снимка данных исследования для экспорта отчёта/проекта.
   * Обходит все сессии, сообщения и наблюдения через appService.
   */
  collectExportData: () => Promise<ExportData>;
  /** Импорт модели из JSON-файла: новая модель с новым id. */
  importModel: (file: File) => Promise<void>;
  /** Импорт проекта из JSON-файла: восстановление моделей, наблюдений, настроек. */
  importProject: (file: File) => Promise<void>;
  /**
   * Применение снимка проекта (R6.4) к рабочей зоне: модели, наблюдения,
   * настройки, последняя проверка. Общий путь для импорта файла и открытия
   * проекта со стартовой страницы — разбор файла берёт на себя вызывающая.
   */
  applyProjectData: (project: ProjectExportFile) => Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

/**
 * Токены отсекают гонки: результат устаревшего запроса не перезаписывает
 * состояние, если пользователь уже выбрал что-то другое.
 */
let requestToken = 0;
let importToken = 0;
/** Антигонка анализа паттернов: новый запуск гасит предыдущий. */
let patternToken = 0;
/**
 * Отдельный счётчик для сравнения. Общий requestToken здесь трогать нельзя:
 * кнопка «Сравнить с…» доступна, пока ещё грузятся байты A, и инкремент
 * общего счётчика отбросил бы их ответ — HEX остался бы на скелетоне.
 */
let compareToken = 0;
/** Отдельный счётчик для «Проверки» — та же причина, что у сравнения. */
let checkToken = 0;
/** Отдельный счётчик для сбора покрытия опкодов (R4.2). */
let coverageToken = 0;
/** Отдельный счётчик для «Применить к записи» (R3-г). */
let applyToken = 0;
/**
 * Правила, изменённые за сессию редактора (R9.2). Накапливаются при saveModel,
 * проверяются один раз при закрытии редактора — предупреждение, не автогашение.
 */
let staleCandidateRuleIds = new Set<string>();
/** Имена правил на момент правки — для текста предупреждения. */
let staleCandidateRuleNames = new Map<string, string>();

export const useAppStore = create<AppState>((set, get) => ({
  captures: [],
  activeCaptureId: null,
  projectCaptureIds: null,

  sessions: [],
  activeSessionId: null,

  messages: [],
  activeMessageId: null,
  messagesError: null,

  bytes: null,
  bytesError: null,
  observations: [],

  selection: null,
  hoveredFieldId: null,

  compareMessageId: null,
  compareAttemptId: null,
  compareError: null,
  compareBytes: null,
  compareBytesLoading: false,
  compareBytesError: null,

  checkOpen: false,
  checkResult: null,
  checkLoading: false,
  checkError: null,
  checkWarnings: null,
  checkCaptureIds: null,
  checkFilter: DEFAULT_CHECK_FILTER,
  checkCoverage: null,
  checkCoverageKey: null,
  checkCoverageLoading: false,
  checkCoverageError: null,
  journalCount: null,

  models: null,
  activeModelId: null,
  messageModels: {},
  modelsLoading: false,

  modelEditorOpen: false,
  staleWarning: null,

  openModelEditor() {
    set({ modelEditorOpen: true });
  },

  closeModelEditor() {
    set({ modelEditorOpen: false });

    // Устаревание (R9.2): правила менялись — ищем связанные наблюдения.
    const ids = [...staleCandidateRuleIds];
    const names = new Map(staleCandidateRuleNames);
    staleCandidateRuleIds.clear();
    staleCandidateRuleNames.clear();
    if (ids.length > 0) {
      void get().checkStaleObservations(ids, names);
    }
  },

  async checkStaleObservations(ruleIds, ruleNames) {
    const { activeCaptureId } = get();
    if (ruleIds.length === 0 || !activeCaptureId) return;

    let sessions: Session[] = [];
    let messages: Message[] = [];
    try {
      sessions = await appService.listSessions(activeCaptureId);
      const lists = await Promise.all(
        sessions.map((session) => appService.listMessages(session.id)),
      );
      messages = lists.flat();
    } catch {
      // Скан предупреждения — сбой списка сообщений не критичен.
      return;
    }

    const wanted = new Set(ruleIds);
    const found: Observation[] = [];
    const packetByObservation = new Map<string, number>();

    // Ограниченная параллельность — тот же паттерн, что в collectExportData.
    let next = 0;
    const worker = async () => {
      while (next < messages.length) {
        const index = next;
        next += 1;
        const message = messages[index];
        try {
          const list = await appService.listObservations(message.id);
          for (const observation of list) {
            if (
              !observation.ruleId ||
              !wanted.has(observation.ruleId) ||
              resolveObservationStatus(observation) === "stale"
            ) {
              continue;
            }
            found.push(observation);
            packetByObservation.set(observation.id, message.packetNumber);
          }
        } catch {
          // Наблюдения одного сообщения не должны ронять скан.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(8, Math.max(messages.length, 1)) }, () =>
        worker(),
      ),
    );

    if (found.length === 0) return;

    const items = found.map((observation) => {
      const packet = packetByObservation.get(observation.id) ?? "?";
      const text = observation.text?.trim() ?? "";
      const short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
      return `пакет №${packet}${short ? `: ${short}` : ""}`;
    });

    set({
      staleWarning: {
        ruleNames: [...new Set(ruleNames.values())],
        items,
        count: found.length,
        observations: found,
      },
      overlayOpen: true,
    });
  },

  async markStaleWarningObservations() {
    const warning = get().staleWarning;
    if (!warning) return;
    for (const observation of warning.observations) {
      await get().saveObservation({ ...observation, status: "stale" });
    }
    set({ staleWarning: null, overlayOpen: false });
  },

  dismissStaleWarning() {
    set({ staleWarning: null, overlayOpen: false });
  },

  applyCaptureProgress: null,
  applyCaptureSummary: null,
  applyCaptureError: null,

  async applyCapture() {
    const { activeCaptureId, activeModelId, models } = get();
    const model = models?.find((item) => item.id === activeModelId) ?? null;
    if (!activeCaptureId || !model) return;

    const token = ++applyToken;
    set({
      applyCaptureProgress: { done: 0, total: 0 },
      applyCaptureSummary: null,
      applyCaptureError: null,
    });

    try {
      const sessions = await appService.listSessions(activeCaptureId);
      const lists = await Promise.all(
        sessions.map((session) => appService.listMessages(session.id)),
      );
      const all = lists.flat();
      const total = all.length;
      if (token !== applyToken) return;
      set({ applyCaptureProgress: { done: 0, total } });

      let parsed = 0;
      let partial = 0;
      let notParsed = 0;
      let done = 0;
      let next = 0;

      // Ограниченная параллельность: мок с задержкой, бэк может быть тяжёлым.
      const worker = async () => {
        while (next < all.length) {
          // Отмена (saveModel/resetProject): не читать байты и не писать кэш
          // по устаревшей модели.
          if (token !== applyToken) return;
          const index = next;
          next += 1;
          const message = all[index];
          const bytes = await appService.getBytes(
            activeCaptureId,
            message.byteOffset,
            message.length,
          );
          // Бэкенд-режим: разбор через POST apply-model (сервер персистит
          // поля/статус), при ошибке — локально. Мок-режим: сразу локально.
          const result = await applyViaServiceOrLocal(message.id, bytes, model);
          if (result.status === "parsed") parsed += 1;
          else if (result.status === "partial") partial += 1;
          else notParsed += 1;
          done += 1;
          if (token === applyToken) {
            set({ applyCaptureProgress: { done, total } });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(8, Math.max(total, 1)) }, () =>
          worker(),
        ),
      );

      if (token !== applyToken) return;
      set({
        applyCaptureProgress: null,
        applyCaptureSummary: { total, parsed, partial, notParsed },
      });
    } catch (error) {
      if (token !== applyToken) return;
      set({
        applyCaptureProgress: null,
        applyCaptureSummary: null,
        applyCaptureError: describeError(error),
      });
    }
  },

  cancelApply() {
    // Токен гасит worker'ы: незавершённые сообщения не досчитываются.
    applyToken += 1;
    set({
      applyCaptureProgress: null,
      applyCaptureSummary: null,
      applyCaptureError: null,
    });
  },

  fieldsSource: "json",

  overlayOpen: false,

  sourcePulseTick: 0,

  sidebarTab: "sessions",
  sidebarCollapsed: false,

  messageFilter: { query: "", direction: "all", status: "all" },
  messageFilterFocusTick: 0,

  loading: NO_LOADING,
  error: null,

  importPhase: "idle",
  importProgress: 0,
  importError: null,
  patternSuggestion: null,
  patternLoading: false,
  inferResult: null,
  inferLoading: false,
  inferError: null,

  async loadProject(selectFirst = true) {
    set((state) => ({
      loading: { ...state.loading, captures: true },
    }));

    let fetched: Capture[] = [];
    try {
      fetched = await appService.listCaptures();
      const scope = get().projectCaptureIds;
      const captures =
        scope === null
          ? fetched
          : fetched.filter((item) => scope.includes(item.id));
      set((state) => ({
        captures,
        loading: { ...state.loading, captures: false },
      }));

      // selectFirst=false: список обновили, выбор — на вызывателе
      // (открытие проекта сразу целится в свою запись, без вспышки чужой).
      const first = selectFirst ? captures[0] : undefined;
      if (first) {
        await get().selectCapture(first.id);
      }
    } catch (error) {
      set((state) => ({
        loading: { ...state.loading, captures: false },
        error: describeError(error),
      }));
    }

    // Модели (R3) грузятся отдельно: их сбой не должен ронять просмотр записи.
    void get().loadModels();
    return fetched;
  },

  async selectCapture(captureId) {
    const scope = get().projectCaptureIds;
    if (scope !== null && !scope.includes(captureId)) return;
    const token = ++requestToken;

    // Другая запись — сравнивать прежние сообщения больше не с чем.
    get().stopCompare();
    // Проверка (R4.2) идёт по выбранным записям, а не по активной —
    // результат и открытая панель при смене активной записи не трогаем.

    set({
      activeCaptureId: captureId,
      sessions: [],
      activeSessionId: null,
      messages: [],
      activeMessageId: null,
      messagesError: null,
      bytes: null,
      bytesError: null,
      observations: [],
      selection: null,
      journalCount: null,
      // Каскадный сброс: флаги нижестоящих загрузок не должны пережить
      // смену записи — иначе отброшенный ответ оставит скелетон вечно.
      loading: { ...NO_LOADING, sessions: true },
    });

    try {
      // Журнал параллельно с сессиями: он решает, показывать ли кнопку
      // «Проверка». Его сбой не должен ронять просмотр записи.
      const [sessions, actions] = await Promise.all([
        appService.listSessions(captureId),
        appService.listActions(captureId).catch(() => []),
      ]);
      if (token !== requestToken) return;

      set((state) => ({
        sessions,
        journalCount: actions.length,
        loading: { ...state.loading, sessions: false },
      }));

      const first = sessions[0];
      if (first) {
        await get().selectSession(first.id);
      }
    } catch (error) {
      if (token !== requestToken) return;
      set((state) => ({
        loading: { ...state.loading, sessions: false },
        error: describeError(error),
      }));
    }
  },

  async selectSession(sessionId) {
    const token = ++requestToken;

    // Сбрасываем до загрузки: иначе байты прежнего сравнения успеют мигнуть.
    get().stopCompare();

    set({
      activeSessionId: sessionId,
      messages: [],
      activeMessageId: null,
      messagesError: null,
      bytes: null,
      bytesError: null,
      observations: [],
      selection: null,
      // Каскадный сброс: messages — в загрузке, всё ниже — сброшено.
      loading: { ...NO_LOADING, messages: true },
    });

    try {
      const loaded = await appService.listMessages(sessionId);
      if (token !== requestToken) return;

      // Привязки сообщений к моделям (R10.1): локальная карта поверх того,
      // что вернул сервис (у бэка поле появится позже).
      const { messageModels } = get();
      const messages = loaded.map((item) =>
        messageModels[item.id]
          ? { ...item, modelId: messageModels[item.id] }
          : item,
      );

      set((state) => ({
        messages,
        messagesError: null,
        loading: { ...state.loading, messages: false },
      }));
    } catch (error) {
      if (token !== requestToken) return;
      set((state) => ({
        loading: { ...state.loading, messages: false },
        messagesError: describeError(error),
        error: describeError(error),
      }));
    }
  },

  async selectMessage(messageId) {
    const token = ++requestToken;

    const { messages, activeCaptureId, activeMessageId, compareMessageId } =
      get();
    const message = messages.find((item) => item.id === messageId);

    // Второе сообщение сравнивалось именно с текущим A: при смене A
    // сравнение теряет смысл. При повторном выборе того же A — не трогаем.
    if (compareMessageId !== null && activeMessageId !== messageId) {
      get().stopCompare();
    }

    set({
      activeMessageId: messageId,
      bytes: null,
      bytesError: null,
      observations: [],
      selection: null,
    });

    if (!message || !activeCaptureId) return;

    set((state) => ({
      loading: { ...state.loading, bytes: true, observations: true },
    }));

    try {
      const [bytes, observations] = await Promise.all([
        appService.getBytes(
          activeCaptureId,
          message.byteOffset,
          message.length,
        ),
        appService.listObservations(messageId),
      ]);

      if (token !== requestToken) return;

      set((state) => ({
        bytes,
        bytesError: null,
        observations,
        loading: { ...state.loading, bytes: false, observations: false },
      }));
    } catch (error) {
      if (token !== requestToken) return;
      set((state) => ({
        loading: { ...state.loading, bytes: false, observations: false },
        bytesError: describeError(error),
        error: describeError(error),
      }));
    }
  },

  setSelection(range) {
    set({ selection: range });
  },

  gotoOffset(offset) {
    const { messages, activeMessageId } = get();
    const message = messages.find((item) => item.id === activeMessageId);
    if (!message || message.length === 0) return;

    const clamped = Math.max(0, Math.min(offset, message.length - 1));
    set({ selection: { offset: clamped, length: 1 } });
  },

  setHoveredField(fieldId) {
    set({ hoveredFieldId: fieldId });
  },

  async saveObservation(input) {
    let observation = input;
    const range = observation.range;

    // Автосвязь с правилом (R9.2): новое наблюдение на байтах, попавших
    // в поле правила. Правки существующих наблюдений не перепривязываются.
    if (observation.ruleId === undefined && range && range.length > 0) {
      const { activeMessageId, bytes, models, activeModelId, messages } = get();
      const message =
        messages.find((item) => item.id === observation.messageId) ?? null;
      // Своя модель сообщения (R10.1) или активная модель проекта.
      const model = resolveMessageModel(message, models, activeModelId);
      if (model && bytes && activeMessageId === observation.messageId) {
        const apply = await applyViaServiceOrLocal(
          observation.messageId,
          bytes,
          model,
        );
        const field = apply.fields.find(
          (item) =>
            item.range.offset <= range.offset &&
            item.range.offset + item.range.length >=
              range.offset + range.length,
        );
        if (field?.ruleId) {
          observation = { ...observation, ruleId: field.ruleId };
        }
      }
    }

    await appService.saveObservation(observation);

    const { activeMessageId, observations } = get();
    if (activeMessageId !== observation.messageId) return;

    const exists = observations.some((item) => item.id === observation.id);
    set({
      observations: exists
        ? observations.map((item) =>
            item.id === observation.id ? observation : item,
          )
        : [...observations, observation],
    });
  },

  async removeObservation(observationId) {
    await appService.removeObservation(observationId);

    set((state) => ({
      observations: state.observations.filter(
        (item) => item.id !== observationId,
      ),
    }));
  },

  async startCompare(messageId) {
    const token = ++compareToken;

    const { messages, sessions } = get();
    const message = messages.find((item) => item.id === messageId);
    if (!message) return;

    const session = sessions.find((item) => item.id === message.sessionId);

    // TODO: Когда бэк придёт, session.captureId должен быть всегда. Откат не нужен.
    if (!session?.captureId) {
      set({
        compareMessageId: null,
        compareAttemptId: messageId,
        compareError: "Не удалось определить источник сообщения",
        compareBytes: null,
        compareBytesLoading: false,
        compareBytesError: null,
      });
      return;
    }

    set({
      compareMessageId: messageId,
      compareAttemptId: messageId,
      compareError: null,
      compareBytes: null,
      compareBytesLoading: true,
      compareBytesError: null,
    });

    try {
      const bytesB = await appService.getBytes(
        session.captureId,
        message.byteOffset,
        message.length,
      );

      if (token !== compareToken) return;

      set({ compareBytes: bytesB, compareBytesLoading: false });
    } catch (error) {
      if (token !== compareToken) return;
      set({
        compareBytes: null,
        compareBytesLoading: false,
        compareBytesError: describeError(error),
      });
    }
  },

  stopCompare() {
    // Токен гасит ответ по байтам B, если он ещё в пути.
    compareToken += 1;
    set({
      compareMessageId: null,
      compareAttemptId: null,
      compareError: null,
      compareBytes: null,
      compareBytesLoading: false,
      compareBytesError: null,
    });
  },

  async openCheck() {
    // Проверять нечего — не открываем (кнопка при этом не рендерится).
    if (get().journalCount === 0) return;

    set({ checkOpen: true });
    // Покрытие опкодов (R4.2) собирается параллельно — кэшируется по ключу.
    void get().loadCheckCoverage();
    // Первое открытие сразу запускает проверку; повторное открывает прошлый
    // результат — перезапуск живёт отдельно (ошибка сети и «Повторить»).
    if (get().checkResult === null && get().checkError === null) {
      await get().runCheck();
    }
  },

  closeCheck() {
    set({ checkOpen: false });
  },

  cancelCheck() {
    // Токен гасит ответ идущего прогона; панель остаётся открытой.
    checkToken += 1;
    set({ checkLoading: false });
  },

  setCheckCaptureIds(ids) {
    // Новый выбор = новый прогон: отменяем текущий и гасим результат.
    checkToken += 1;
    coverageToken += 1;
    set({
      checkCaptureIds: ids,
      checkResult: null,
      checkError: null,
      checkLoading: false,
      checkWarnings: null,
      checkCoverage: null,
      checkCoverageKey: null,
      checkCoverageLoading: false,
      checkCoverageError: null,
    });
  },

  setCheckFilter(patch) {
    set((state) => ({ checkFilter: { ...state.checkFilter, ...patch } }));
  },

  resetCheckFilter() {
    set({ checkFilter: DEFAULT_CHECK_FILTER });
  },

  async runCheck() {
    const token = ++checkToken;
    const { captures, checkCaptureIds, activeModelId } = get();

    // Проверяемые записи: null — все загруженные (R4.2).
    const ids = (checkCaptureIds ?? captures.map((item) => item.id)).filter(
      (id) => captures.some((item) => item.id === id),
    );
    if (ids.length === 0) {
      set({
        checkResult: null,
        checkLoading: false,
        checkError: null,
        checkWarnings: null,
      });
      return;
    }

    set({ checkLoading: true, checkError: null, checkWarnings: null });
    // «Перепроверить» добирает и покрытие, если оно упало или сброшено.
    void get().loadCheckCoverage();

    // Агрегация (R4.2): по вызову checkModel на запись, ошибки не роняют итог.
    const settled = await Promise.allSettled(
      ids.map((captureId) =>
        appService.checkModel(captureId, activeModelId ?? undefined),
      ),
    );
    if (token !== checkToken) return;

    const warnings: string[] = [];
    const results: CheckResult[] = [];
    settled.forEach((item, index) => {
      if (item.status === "fulfilled") {
        results.push(item.value);
      } else {
        const capture = captures.find((entry) => entry.id === ids[index]);
        warnings.push(
          `Не удалось проверить запись ${capture ? capture.fileName : ids[index]}`,
        );
      }
    });

    if (results.length === 0) {
      set({
        checkResult: null,
        checkLoading: false,
        checkError: warnings[0] ?? "Не удалось проверить записи",
        checkWarnings: null,
      });
      return;
    }

    // Слияние: строки с префиксом записи (id строк у мока совпадают между
    // записями), сводка — сумма по всем проверенным записям.
    const rows: CheckRow[] = [];
    const summary = { total: 0, ok: 0, partial: 0, unknown: 0, error: 0 };
    results.forEach((result, index) => {
      const prefix = ids[index];
      for (const row of result.rows) {
        rows.push({ ...row, id: `${prefix}:${row.id}` });
      }
      summary.total += result.summary.total;
      summary.ok += result.summary.ok;
      summary.partial += result.summary.partial;
      summary.unknown += result.summary.unknown;
      summary.error += result.summary.error;
    });

    set({
      checkResult: {
        rows,
        summary,
        modelId: results[0].modelId ?? null,
        modelName: results[0].modelName ?? null,
      },
      checkLoading: false,
      checkWarnings: warnings.length > 0 ? warnings : null,
    });
  },

  async loadCheckCoverage() {
    const { captures, checkCaptureIds, activeModelId, models } = get();
    const model = models?.find((item) => item.id === activeModelId) ?? null;
    const ids = (checkCaptureIds ?? captures.map((item) => item.id)).filter(
      (id) => captures.some((item) => item.id === id),
    );
    const key = `${activeModelId ?? "—"}:${[...ids].sort().join(",")}`;

    // Кэш: покрытие уже посчитано для этой модели и этого выбора.
    if (get().checkCoverage !== null && get().checkCoverageKey === key) {
      return;
    }

    if (!model || ids.length === 0) {
      coverageToken += 1;
      set({
        checkCoverage: null,
        checkCoverageKey: null,
        checkCoverageLoading: false,
        checkCoverageError: null,
      });
      return;
    }

    const token = ++coverageToken;
    set({ checkCoverageLoading: true, checkCoverageError: null });

    try {
      // Опкоды, заявленные в правилах модели.
      const covered = new Set<number>();
      for (const rule of model.rules) {
        if (rule.condition.opcode !== undefined) {
          covered.add(rule.condition.opcode);
        }
        for (const opcode of rule.condition.opcodes ?? []) {
          covered.add(opcode);
        }
      }

      // Опкоды, реально встреченные в сообщениях выбранных записей:
      // opcode кадра — байт смещения 2 (AA 55 | opcode | length | …).
      const seen = new Set<number>();
      for (const captureId of ids) {
        const sessions = await appService.listSessions(captureId);
        if (token !== coverageToken) return;
        const lists = await Promise.all(
          sessions.map((session) => appService.listMessages(session.id)),
        );
        const all = lists.flat();

        let next = 0;
        const worker = async () => {
          while (next < all.length) {
            const index = next;
            next += 1;
            if (token !== coverageToken) return;
            const message = all[index];
            if (message.length < 3) continue;
            const bytes = await appService.getBytes(
              captureId,
              message.byteOffset,
              3,
            );
            if (token !== coverageToken) return;
            seen.add(bytes[2]);
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(8, Math.max(all.length, 1)) }, () =>
            worker(),
          ),
        );
      }

      if (token !== coverageToken) return;
      set({
        checkCoverage: {
          covered: [...covered].sort((a, b) => a - b),
          seen: [...seen].sort((a, b) => a - b),
        },
        checkCoverageKey: key,
        checkCoverageLoading: false,
      });
    } catch (error) {
      if (token !== coverageToken) return;
      set({
        checkCoverage: null,
        checkCoverageKey: null,
        checkCoverageLoading: false,
        checkCoverageError: describeError(error),
      });
    }
  },

  async loadModels() {
    set({ modelsLoading: true });
    try {
      const models = await appService.listModels();
      set({
        models,
        modelsLoading: false,
        // Первая модель активна по умолчанию; пустой список — активной нет.
        activeModelId: models[0]?.id ?? null,
      });
    } catch {
      // Сбой моделей не должен ронять просмотр записи.
      set({ models: [], modelsLoading: false, activeModelId: null });
    }
  },

  setActiveModel(modelId) {
    // Смена активной модели делает старый кэш непригодным.
    get().invalidateModelFields();
    // И результат проверки относится к прежней модели — сбрасываем.
    checkToken += 1;
    // Покрытие опкодов тоже зависит от модели.
    coverageToken += 1;
    // Итог «Применить к записи» тоже относится к прежней модели.
    set({
      activeModelId: modelId,
      checkResult: null,
      checkError: null,
      checkLoading: false,
      checkCoverage: null,
      checkCoverageKey: null,
      checkCoverageLoading: false,
      checkCoverageError: null,
      applyCaptureSummary: null,
    });
  },

  setFieldsSource(source) {
    set({ fieldsSource: source });
  },

  setMessageModel(messageId, modelId) {
    const { messageModels, messages } = get();
    const next = { ...messageModels };
    if (modelId === null) {
      delete next[messageId];
    } else {
      next[messageId] = modelId;
    }

    // Кэш разбора ключуется messageId:modelId — смена привязки лишь
    // переключает сообщение на другой ключ, старая запись остаётся
    // валидной для прежней пары. Инвалидация не нужна.
    set({
      messageModels: next,
      messages: messages.map((item) => {
        if (item.id !== messageId) return item;
        if (modelId === null) {
          const { modelId: _dropped, ...rest } = item;
          return rest;
        }
        return { ...item, modelId };
      }),
    });
  },

  invalidateModelFields(modelId) {
    invalidateApplyCache(modelId);
  },

  async saveModel(model) {
    await appService.saveModel(model);
    get().invalidateModelFields(model.id);
    // Правка модели обесценивает результат проверки — сбрасываем.
    checkToken += 1;
    // И правка обесценивает итог применения и прерывает текущий прогон.
    applyToken += 1;
    // Покрытие опкодов зависит от правил — сбрасываем.
    coverageToken += 1;
    const { models } = get();
    if (models === null) return;

    // Устаревание (R9.2): фиксируем правила с изменённым условием/полями
    // и удалённые — их наблюдения проверим при закрытии редактора.
    const previous = models.find((item) => item.id === model.id) ?? null;
    if (previous) {
      const prevById = new Map(previous.rules.map((rule) => [rule.id, rule]));
      for (const rule of model.rules) {
        const before = prevById.get(rule.id);
        if (
          before &&
          (JSON.stringify(before.condition) !==
            JSON.stringify(rule.condition) ||
            JSON.stringify(before.fields) !== JSON.stringify(rule.fields))
        ) {
          staleCandidateRuleIds.add(rule.id);
          staleCandidateRuleNames.set(rule.id, rule.name);
        }
      }
      for (const before of previous.rules) {
        if (!model.rules.some((rule) => rule.id === before.id)) {
          staleCandidateRuleIds.add(before.id);
          staleCandidateRuleNames.set(before.id, before.name);
        }
      }
    }

    const exists = models.some((item) => item.id === model.id);
    set({
      models: exists
        ? models.map((item) => (item.id === model.id ? model : item))
        : [...models, model],
      checkResult: null,
      checkError: null,
      checkLoading: false,
      checkCoverage: null,
      checkCoverageKey: null,
      checkCoverageLoading: false,
      checkCoverageError: null,
      applyCaptureProgress: null,
      applyCaptureSummary: null,
      applyCaptureError: null,
    });
  },

  async removeModel(modelId) {
    await appService.removeModel(modelId);
    get().invalidateModelFields(modelId);
    const { models, activeModelId, messageModels, messages } = get();

    // Привязки на удалённую модель снимаются: сообщения вернутся
    // к активной модели проекта.
    const nextMessageModels = { ...messageModels };
    for (const [messageId, linkedId] of Object.entries(nextMessageModels)) {
      if (linkedId === modelId) delete nextMessageModels[messageId];
    }
    const nextMessages = messages.map((item) => {
      if (item.modelId !== modelId) return item;
      const { modelId: _dropped, ...rest } = item;
      return rest;
    });

    if (models === null) return;

    const next = models.filter((item) => item.id !== modelId);
    const nextActiveId =
      activeModelId === modelId ? (next[0]?.id ?? null) : activeModelId;
    if (nextActiveId !== activeModelId) {
      // Удалили активную — проверка сделана по прежней модели.
      checkToken += 1;
      set({
        models: next,
        activeModelId: nextActiveId,
        messageModels: nextMessageModels,
        messages: nextMessages,
        checkResult: null,
        checkError: null,
        checkLoading: false,
      });
      return;
    }
    set({
      models: next,
      activeModelId: nextActiveId,
      messageModels: nextMessageModels,
      messages: nextMessages,
    });
  },

  async collectExportData() {
    const {
      captures,
      activeCaptureId,
      models,
      activeModelId,
      checkResult,
    } = get();

    const capture =
      captures.find((item) => item.id === activeCaptureId) ?? null;
    const model =
      models?.find((item) => item.id === activeModelId) ?? null;

    let sessions: Session[] = [];
    let messages: Message[] = [];
    if (activeCaptureId) {
      sessions = await appService.listSessions(activeCaptureId);
      const lists = await Promise.all(
        sessions.map((session) => appService.listMessages(session.id)),
      );
      messages = lists.flat();
    }

    // Наблюдения по всем сообщениям — пулом, чтобы мок с задержкой не растянул экспорт.
    const observations: Observation[] = [];
    const applyByMessage = new Map<string, ApplySummary>();
    const opcodes = new Map<number, number>();

    let next = 0;
    const worker = async () => {
      while (next < messages.length) {
        const index = next;
        next += 1;
        const message = messages[index];

        const [obs, bytes] = await Promise.all([
          appService.listObservations(message.id),
          activeCaptureId
            ? appService.getBytes(
                activeCaptureId,
                message.byteOffset,
                message.length,
              )
            : Promise.resolve<Uint8Array | null>(null),
        ]);
        observations.push(...obs);

        if (bytes && bytes.length > 2) {
          const opcode = bytes[2];
          opcodes.set(opcode, (opcodes.get(opcode) ?? 0) + 1);
        }
        if (model && bytes) {
          const result = await applyViaServiceOrLocal(message.id, bytes, model);
          applyByMessage.set(message.id, {
            status: result.status,
            uncovered: result.uncovered,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(8, Math.max(messages.length, 1)) }, () =>
        worker(),
      ),
    );

    return {
      generatedAt: new Date().toISOString(),
      capture,
      model,
      models: models ?? [],
      sessionsCount: sessions.length,
      messages,
      applyByMessage: model ? applyByMessage : null,
      opcodes: model ? opcodes : null,
      observations,
      checkResult,
    };
  },

  async importModel(file) {
    const text = await file.text();
    const model = parseModelExport(text);
    await get().saveModel(model);
    get().setActiveModel(model.id);
  },

  async importProject(file) {
    const text = await file.text();
    const project = parseProjectExport(text);
    await get().applyProjectData(project);
  },

  async applyProjectData(project) {
    // Модели и наблюдения — через сервис (upsert по id).
    for (const model of project.models) {
      await appService.saveModel(model);
    }
    for (const observation of project.observations) {
      await appService.saveObservation(observation);
    }

    // Перечитываем список моделей и выставляем активную из файла.
    await get().loadModels();
    // Модели принадлежат проекту: снимок — истина. Глобальный список
    // бэкенда может содержать модели других проектов — отрезаем чужие,
    // иначе они синхронизируются между проектами.
    const wantedModelIds = new Set(project.models.map((item) => item.id));
    const scopedModels = (get().models ?? []).filter((item) =>
      wantedModelIds.has(item.id),
    );
    set({ models: scopedModels });
    if (
      project.active.modelId &&
      scopedModels.some((item) => item.id === project.active.modelId)
    ) {
      get().setActiveModel(project.active.modelId);
    } else if (
      get().activeModelId &&
      !scopedModels.some((item) => item.id === get().activeModelId)
    ) {
      // Активная из прошлого контекста в проект не входит — откат.
      get().setActiveModel(scopedModels[0]?.id ?? null);
    }

    // Записи принадлежат проекту: видны только записи снимка (плюс
    // импортированные позже — startImport дописывает в конец списка).
    // Иначе дропдаун записей общий на все проекты.
    const wantedIds = new Set(snapshotCaptureIds(project));
    set({ projectCaptureIds: [...wantedIds] });
    set({
      captures: get().captures.filter((item) => wantedIds.has(item.id)),
    });
    if (
      get().activeCaptureId !== null &&
      wantedIds.has(get().activeCaptureId as string)
    ) {
      // Данные уже принадлежат нужной записи — гасить нечего.
      // Чистка тут давала бы лишний пустой кадр («Сессия не выбрана»)
      // между перевыбором сессий.
    } else {
      // Выбранной записи в проекте нет — гасим зависимое состояние,
      // иначе покажем чужие сессии/сообщения без их записи.
      get().stopCompare();
      set({
        activeCaptureId: null,
        sessions: [],
        activeSessionId: null,
        messages: [],
        activeMessageId: null,
        messagesError: null,
        bytes: null,
        bytesError: null,
        observations: [],
        selection: null,
        hoveredFieldId: null,
        journalCount: null,
        // Дальше выбираем запись явно (ниже), она включит свои скелетоны.
        // Голый NO_LOADING тут рисовал бы «Сессия не выбрана» навсегда.
        loading: NO_LOADING,
      });
    }

    // Источник полей, привязки сообщений к моделям и последняя проверка.
    checkToken += 1;
    set({
      fieldsSource: project.active.fieldsSource,
      messageModels: project.active.messageModels ?? {},
      checkResult: project.checkResult,
      checkError: null,
      checkLoading: false,
    });

    // Запись проекта: сначала своя из снимка, иначе первая из скоупа.
    // (Фолбэк на случай, если запись снимка пропала из бэкенда —
    // например, файл переимпортировали под новым id.)
    const scopeIds = new Set(snapshotCaptureIds(project));
    let targetId: string | null = null;
    if (project.capture && scopeIds.has(project.capture.id)) {
      targetId = project.capture.id;
    } else {
      targetId = get().captures[0]?.id ?? null;
    }
    if (targetId && targetId !== get().activeCaptureId) {
      await get().selectCapture(targetId);
    }
    const { activeCaptureId } = get();
    if (project.capture && project.capture.id === activeCaptureId) {
      if (
        project.active.sessionId &&
        get().sessions.some((item) => item.id === project.active.sessionId)
      ) {
        await get().selectSession(project.active.sessionId);
        if (
          project.active.messageId &&
          get().messages.some((item) => item.id === project.active.messageId)
        ) {
          await get().selectMessage(project.active.messageId);
        }
      }
    }
  },

  async gotoMessage(messageId) {
    const { messages } = get();
    if (messages.some((item) => item.id === messageId)) {
      await get().selectMessage(messageId);
      return;
    }

    // Сообщение может жить в другой сессии — ищем по спискам сессий записи.
    try {
      const { sessions } = get();
      for (const session of sessions) {
        const list = await appService.listMessages(session.id);
        if (list.some((item) => item.id === messageId)) {
          await get().selectSession(session.id);
          await get().selectMessage(messageId);
          return;
        }
      }
    } catch (error) {
      // Сбой поиска не должен давать unhandled rejection (void gotoMessage).
      set({ error: describeError(error) });
    }
  },

  setOverlayOpen(open) {
    set({ overlayOpen: open });
  },

  pulseSource() {
    set((state) => ({ sourcePulseTick: state.sourcePulseTick + 1 }));
  },

  async getMessageBytes(messageId) {
    const { messages, activeCaptureId } = get();
    const message = messages.find((item) => item.id === messageId);

    // TODO: Когда бэк придёт, activeCaptureId должен быть всегда.
    if (!message || !activeCaptureId) {
      throw new Error("Не удалось получить байты сообщения");
    }

    return appService.getBytes(
      activeCaptureId,
      message.byteOffset,
      message.length,
    );
  },

  setSidebarTab(tab) {
    set({ sidebarTab: tab });
  },

  toggleSidebar() {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },

  setSidebarCollapsed(collapsed) {
    set({ sidebarCollapsed: collapsed });
  },

  setMessageFilter(patch) {
    set((state) => ({ messageFilter: { ...state.messageFilter, ...patch } }));
  },

  resetMessageFilter() {
    set({ messageFilter: { query: "", direction: "all", status: "all" } });
  },

  focusMessageFilter() {
    set((state) => ({
      messageFilterFocusTick: state.messageFilterFocusTick + 1,
    }));
  },

  async startImport(file) {
    const token = ++importToken;

    set({ importPhase: "running", importProgress: 0, importError: null });

    // Проверка до отправки в сервис: accept в диалоге — только подсказка.
    const name = file.name.toLowerCase();
    const allowed = [".pcap", ".pcapng", ".cap"];
    if (!allowed.some((ext) => name.endsWith(ext))) {
      set({
        importPhase: "error",
        importProgress: 0,
        importError: `Не удалось прочитать ${file.name}: нужен файл ${allowed.join(" или ")}`,
      });
      return;
    }
    // Потолок на всякий случай: ТЗ закладывается на записи до ~100 МиБ.
    const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
    if (file.size > MAX_IMPORT_BYTES) {
      set({
        importPhase: "error",
        importProgress: 0,
        importError: `Не удалось прочитать ${file.name}: файл больше 200 МиБ`,
      });
      return;
    }

    try {
      const capture = await appService.importCapture(file);
      if (token !== importToken) return;

      set((state) => ({
        captures: [...state.captures, capture],
        projectCaptureIds: state.projectCaptureIds === null
          ? [capture.id]
          : state.projectCaptureIds.includes(capture.id)
            ? state.projectCaptureIds
            : [...state.projectCaptureIds, capture.id],
        importPhase: "done",
        importProgress: 1,
      }));

      await get().selectCapture(capture.id);
      if (token !== importToken) return;
      // Автопоиск паттернов: тихо; диалог — только если есть находки.
      void get().analyzePatterns();
    } catch (error) {
      if (token !== importToken) return;
      set({
        importPhase: "error",
        importProgress: 0,
        importError: describeError(error),
      });
    }
  },

  setImportProgress(value) {
    set({ importProgress: Math.min(1, Math.max(0, value)) });
  },

  cancelImport() {
    // Токен отменяет применение результата, если импорт всё-таки доехал.
    importToken += 1;
    set({ importPhase: "idle", importProgress: 0, importError: null });
  },

  dismissImportError() {
    set({ importPhase: "idle", importError: null });
  },

  async analyzePatterns() {
    const token = ++patternToken;
    const { activeCaptureId, messages } = get();
    if (!activeCaptureId) return false;

    // Достаточно первых сообщений активной сессии — закономерности
    // повторяются по всему потоку.
    const ordered = [...messages]
      .sort((a, b) => a.packetNumber - b.packetNumber)
      .slice(0, PATTERN_SAMPLE_LIMIT);
    if (ordered.length === 0) return false;

    set({ patternLoading: true });
    try {
      const samples: MessageSample[] = [];
      // Пачками по 8: байты независимы, но поток запросов ограничен.
      for (let index = 0; index < ordered.length; index += 8) {
        const chunk = ordered.slice(index, index + 8);
        const loaded = await Promise.all(
          chunk.map((item) =>
            appService
              .getBytes(activeCaptureId, item.byteOffset, item.length)
              .catch(() => null),
          ),
        );
        if (token !== patternToken) return false;
        for (const bytes of loaded) {
          if (bytes) samples.push({ bytes });
        }
      }

      const capture = get().captures.find((item) => item.id === activeCaptureId);
      const suggestion = analyzeCapture(samples, capture?.fileName ?? null);
      if (token !== patternToken) return false;

      const hasFindings = suggestion.findings.length > 0;
      set({
        patternLoading: false,
        patternSuggestion: hasFindings ? suggestion : null,
      });
      return hasFindings;
    } catch {
      if (token === patternToken) set({ patternLoading: false });
      return false;
    }
  },

  async acceptPatternSuggestion() {
    const suggestion = get().patternSuggestion;
    if (!suggestion?.model) return;
    const model = suggestion.model;
    set({ patternSuggestion: null });
    await get().saveModel(model);
    get().setActiveModel(model.id);
  },

  dismissPatternSuggestion() {
    // Гасит и идущий анализ: отклонённое предложение не должно вернуться.
    patternToken += 1;
    set({ patternSuggestion: null, patternLoading: false });
  },

  async inferModelFromJournal() {
    const { activeCaptureId } = get();
    if (!activeCaptureId) return false;
    set({ inferLoading: true, inferError: null });
    try {
      const result = await appService.inferModel(activeCaptureId);
      set({ inferLoading: false, inferResult: result });
      return result.model.rules.length > 0;
    } catch (error) {
      set({
        inferLoading: false,
        inferError: describeError(error),
        inferResult: null,
      });
      return false;
    }
  },

  async acceptInferModel() {
    const result = get().inferResult;
    if (!result) return;
    set({ inferResult: null });
    await get().saveModel(result.model);
    get().setActiveModel(result.model.id);
  },

  dismissInferModel() {
    set({ inferResult: null, inferLoading: false, inferError: null });
  },

  resetProject() {
    requestToken += 1;
    checkToken += 1;
    coverageToken += 1;
    applyToken += 1;
    patternToken += 1;
    staleCandidateRuleIds.clear();
    staleCandidateRuleNames.clear();
    set({
      captures: [],
      activeCaptureId: null,
      projectCaptureIds: null,
      sessions: [],
      activeSessionId: null,
      messages: [],
      activeMessageId: null,
      messagesError: null,
      bytes: null,
      bytesError: null,
      observations: [],
      selection: null,
      hoveredFieldId: null,
      // Все флаги загрузки сбрасываются: отброшенные токенами ответы
      // иначе оставят бы скелетоны вечно.
      loading: NO_LOADING,
      compareMessageId: null,
      compareAttemptId: null,
      compareError: null,
      compareBytes: null,
      compareBytesLoading: false,
      compareBytesError: null,
      checkOpen: false,
      checkResult: null,
      checkLoading: false,
      checkError: null,
      checkWarnings: null,
      checkCaptureIds: null,
      checkFilter: DEFAULT_CHECK_FILTER,
      checkCoverage: null,
      checkCoverageKey: null,
      checkCoverageLoading: false,
      checkCoverageError: null,
      journalCount: null,
      models: null,
      activeModelId: null,
      messageModels: {},
      modelsLoading: false,
      modelEditorOpen: false,
      staleWarning: null,
      applyCaptureProgress: null,
      applyCaptureSummary: null,
      applyCaptureError: null,
      fieldsSource: "json",
      // error намеренно не сбрасывается: он показывается баннером рабочей
      // области до явного скрытия. Иначе при повторном открытии проекта
      // (ошибка та же) баннер не появится снова.
      importPhase: "idle",
      importProgress: 0,
      importError: null,
      patternSuggestion: null,
      patternLoading: false,
      inferResult: null,
      inferLoading: false,
      inferError: null,
    });
  },
}));
