/**
 * Состояние приложения.
 *
 * Работа с данными — только через appService (§16: не смешивать UI и данные).
 * Стор не знает ни о моках, ни о сценариях: при подключении бэкенда этот файл
 * не меняется.
 */
import { create } from "zustand";
import { appService } from "@/src/services";
import type {
  ByteRange,
  Capture,
  CheckResult,
  Message,
  Observation,
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

  sessions: Session[];
  activeSessionId: string | null;

  messages: Message[];
  activeMessageId: string | null;

  bytes: Uint8Array | null;
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
   * Действий в журнале текущей записи. null — ещё не известно.
   * Кнопка «Проверка» рендерится только при журнале > 0.
   */
  journalCount: number | null;

  /** Портальный слой Radix (Select, Popover) открыт — Esc адресован ему. */
  overlayOpen: boolean;

  /**
   * Тик для заглушки «показать в пакете»: work-area ловит изменение
   * и подсвечивает ссылку на пакет в шапке.
   */
  sourcePulseTick: number;

  sidebarTab: SidebarTab;
  sidebarCollapsed: boolean;

  loading: Record<LoadingKey, boolean>;
  error: string | null;

  importPhase: ImportPhase;
  /** 0…1. Прогресс импорта; заполняется тем, кто умеет его сообщать. */
  importProgress: number;
  importError: string | null;

  loadProject: () => Promise<void>;
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
  startImport: (file: File) => Promise<void>;
  setImportProgress: (value: number) => void;
  cancelImport: () => void;
  dismissImportError: () => void;
  resetProject: () => void;
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
/**
 * Отдельный счётчик для сравнения. Общий requestToken здесь трогать нельзя:
 * кнопка «Сравнить с…» доступна, пока ещё грузятся байты A, и инкремент
 * общего счётчика отбросил бы их ответ — HEX остался бы на скелетоне.
 */
let compareToken = 0;
/** Отдельный счётчик для «Проверки» — та же причина, что у сравнения. */
let checkToken = 0;

export const useAppStore = create<AppState>((set, get) => ({
  captures: [],
  activeCaptureId: null,

  sessions: [],
  activeSessionId: null,

  messages: [],
  activeMessageId: null,

  bytes: null,
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
  journalCount: null,

  overlayOpen: false,

  sourcePulseTick: 0,

  sidebarTab: "sessions",
  sidebarCollapsed: false,

  loading: NO_LOADING,
  error: null,

  importPhase: "idle",
  importProgress: 0,
  importError: null,

  async loadProject() {
    set((state) => ({
      loading: { ...state.loading, captures: true },
      error: null,
    }));

    try {
      const captures = await appService.listCaptures();
      set((state) => ({
        captures,
        loading: { ...state.loading, captures: false },
      }));

      const first = captures[0];
      if (first) {
        await get().selectCapture(first.id);
      }
    } catch (error) {
      set((state) => ({
        loading: { ...state.loading, captures: false },
        error: describeError(error),
      }));
    }
  },

  async selectCapture(captureId) {
    const token = ++requestToken;

    // Другая запись — сравнивать прежние сообщения больше не с чем.
    get().stopCompare();
    // Проверка относится к прежней записи — закрываем.
    get().closeCheck();

    set((state) => ({
      activeCaptureId: captureId,
      sessions: [],
      activeSessionId: null,
      messages: [],
      activeMessageId: null,
      bytes: null,
      observations: [],
      selection: null,
      checkResult: null,
      checkError: null,
      journalCount: null,
      loading: { ...state.loading, sessions: true },
    }));

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

    set((state) => ({
      activeSessionId: sessionId,
      messages: [],
      activeMessageId: null,
      bytes: null,
      observations: [],
      selection: null,
      loading: { ...state.loading, messages: true },
    }));

    try {
      const messages = await appService.listMessages(sessionId);
      if (token !== requestToken) return;

      set((state) => ({
        messages,
        loading: { ...state.loading, messages: false },
      }));
    } catch (error) {
      if (token !== requestToken) return;
      set((state) => ({
        loading: { ...state.loading, messages: false },
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
        observations,
        loading: { ...state.loading, bytes: false, observations: false },
      }));
    } catch (error) {
      if (token !== requestToken) return;
      set((state) => ({
        loading: { ...state.loading, bytes: false, observations: false },
        error: describeError(error),
      }));
    }
  },

  setSelection(range) {
    set({ selection: range });
  },

  setHoveredField(fieldId) {
    set({ hoveredFieldId: fieldId });
  },

  async saveObservation(observation) {
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
    // Первое открытие сразу запускает проверку; повторное открывает прошлый
    // результат — перезапуск живёт отдельно (ошибка сети и «Повторить»).
    if (get().checkResult === null && get().checkError === null) {
      await get().runCheck();
    }
  },

  closeCheck() {
    set({ checkOpen: false });
  },

  async runCheck() {
    const token = ++checkToken;
    const { activeCaptureId } = get();
    if (!activeCaptureId) return;

    set({ checkLoading: true, checkError: null });

    try {
      const checkResult = await appService.checkModel(activeCaptureId);
      if (token !== checkToken) return;
      set({ checkResult, checkLoading: false });
    } catch (error) {
      if (token !== checkToken) return;
      set({ checkResult: null, checkLoading: false, checkError: describeError(error) });
    }
  },

  async gotoMessage(messageId) {
    const { messages } = get();
    if (messages.some((item) => item.id === messageId)) {
      await get().selectMessage(messageId);
      return;
    }

    // Сообщение может жить в другой сессии — ищем по спискам сессий записи.
    const { sessions } = get();
    for (const session of sessions) {
      const list = await appService.listMessages(session.id);
      if (list.some((item) => item.id === messageId)) {
        await get().selectSession(session.id);
        await get().selectMessage(messageId);
        return;
      }
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

  async startImport(file) {
    const token = ++importToken;

    set({ importPhase: "running", importProgress: 0, importError: null });

    try {
      const capture = await appService.importCapture(file);
      if (token !== importToken) return;

      set((state) => ({
        captures: [...state.captures, capture],
        importPhase: "done",
        importProgress: 1,
      }));

      await get().selectCapture(capture.id);
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

  resetProject() {
    requestToken += 1;
    checkToken += 1;
    set({
      captures: [],
      activeCaptureId: null,
      sessions: [],
      activeSessionId: null,
      messages: [],
      activeMessageId: null,
      bytes: null,
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
      journalCount: null,
      error: null,
      importPhase: "idle",
      importProgress: 0,
      importError: null,
    });
  },
}));
