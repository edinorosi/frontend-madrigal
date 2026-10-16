/**
 * Стартовая страница: список проектов и навигация «список ↔ рабочая зона».
 *
 * Отдельный стор, а не поля главного: выбор проекта — экран, который живёт
 * до открытия рабочей зоны, и данные исследования к нему не относятся.
 * Связь однонаправленная: этот стор вызывает действия app-store (открытие,
 * снимок, сброс), но не наоборот. Контракт AppService и поведение рабочей
 * зоны не меняются — ни здесь, ни в компонентах.
 *
 * Навигация — состояние, а не роут (как modelEditorOpen): статический экспорт
 * не требует маршрута, а «назад» в топбаре не нуждается в истории браузера.
 */
import { create } from "zustand";
import { downloadJson } from "@/src/lib/export/download";
import {
  buildProjectExport,
  captureRefOf,
  normalizeProjectData,
  parseProjectExport,
  projectFileName,
  type ProjectExportFile,
} from "@/src/lib/export/project-export";
import {
  DEMO_PROJECT_ID,
  emptyProjectData,
  isEmptySnapshot,
  nextProjectId,
  projectTitle,
  readIndex,
  readRecord,
  removeRecord,
  writeIndex,
  writeRecord,
  type ProjectMeta,
  type ProjectRecord,
} from "@/src/lib/projects";
import { appService } from "@/src/services";
import { useAppStore } from "@/src/store/app";
import type { Observation } from "@/src/types/domain";

/** Какой экран показывает приложение. */
export type AppView = "projects" | "workspace";

interface ProjectsState {
  /** Текущий экран; при запуске — список проектов. */
  view: AppView;
  /** Открытый проект; null — ни один не открыт. */
  activeProjectId: string | null;
  /** Список проектов из localStorage, новый сверху. */
  projects: ProjectMeta[];
  /** Идёт операция с проектом — кнопки недоступны. */
  busy: boolean;
  /** Идёт автосохранение снимка при выходе — «Сохранение…» в топбаре. */
  saving: boolean;
  /** Ошибка операции — баннер на стартовой странице. */
  error: string | null;

  /** Чтение индекса из localStorage (вызывается при монтировании). */
  loadProjects: () => void;
  clearError: () => void;
  /** Новый пустой проект: без записи, без сессий и сообщений. */
  createProject: (name: string) => Promise<void>;
  /** Импорт проекта из JSON (R6.4): разбор, добавление в список, открытие. */
  importProjectFile: (file: File) => Promise<void>;
  /** Быстрый старт: запись PCAP → новый проект → рабочая зона. */
  createFromCapture: (file: File) => Promise<void>;
  /** Демонстрационный проект с записью из моков. */
  openDemo: () => Promise<void>;
  /** Открытие проекта: сброс рабочей зоны, загрузка, применение снимка. */
  openProject: (id: string) => Promise<void>;
  /**
   * Очистка повреждённого проекта (кнопка [Очистить] на баннере 404):
   * удаляется только тело проекта, рабочая зона гаснет до «Проект не загружен».
   */
  clearProject: (id: string) => void;
  /** Возврат к списку: автосохранение снимка проекта. */
  backToProjects: () => Promise<void>;
  deleteProject: (id: string) => void;
  /** Скачивание проекта в JSON — тем же форматом, что импорт. */
  exportProject: (id: string) => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

/**
 * Нормализация снимка перед открытием: id записей снимка могут уже
 * отсутствовать в сервисе (файл переимпортировали под новым id, данные
 * бэкенда очистили). Доступные id берём из listCaptures(). Сбой списка
 * (бэкенд недоступен) снимок не трогает — открытие покажет ошибку связи.
 */
async function normalizeSnapshot(
  data: ProjectExportFile | null,
): Promise<ProjectExportFile | null> {
  if (data === null) return null;
  try {
    const captures = await appService.listCaptures();
    return normalizeProjectData(
      data,
      captures.map((item) => item.id),
    );
  } catch {
    return data;
  }
}

function byUpdatedDesc(left: ProjectMeta, right: ProjectMeta): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function upsertMeta(list: ProjectMeta[], meta: ProjectMeta): ProjectMeta[] {
  return [...list.filter((item) => item.id !== meta.id), meta].sort(
    byUpdatedDesc,
  );
}

/**
 * Сохранение тела проекта и индекса. Порядок — тело, затем индекс.
 * Если индекс записать не удалось, новое тело удаляется: битая ссылка
 * в списке хуже отсутствующего проекта. Существующий проект при этом
 * остаётся (в индексе — прежние метаданные, в теле — новые данные).
 * Возвращает обновлённый список или null — хранилище не приняло проект.
 */
function persistRecord(
  list: ProjectMeta[],
  record: ProjectRecord,
): ProjectMeta[] | null {
  const existed = readRecord(record.meta.id) !== null;
  if (!writeRecord(record)) return null;

  const next = upsertMeta(list, record.meta);
  if (!writeIndex(next)) {
    if (!existed) removeRecord(record.meta.id);
    return null;
  }
  return next;
}

/** Счётчик хранилища недоступен — одна формулировка на все места. */
const STORAGE_ERROR =
  "Не удалось сохранить проект: хранилище браузера недоступно или переполнено";

/** Пул обхода сообщений при автосохранении — мок с задержкой не должен растянуть выход из проекта. */
const SAVE_POOL = 16;

/**
 * Лёгкий снимок для автосохранения: наблюдения по всем сообщениям записи.
 * В отличие от collectExportData (экспорт отчёта) байты не читаются:
 * конверту проекта (R6.4) не нужны ни байты, ни опкоды, ни покрытие —
 * только модели, наблюдения, настройки и последняя проверка.
 */
async function collectSaveSnapshot(captureId: string | null): Promise<{
  observations: Observation[];
  sessionsCount: number;
  messagesCount: number;
}> {
  if (!captureId) {
    return { observations: [], sessionsCount: 0, messagesCount: 0 };
  }

  const sessions = await appService.listSessions(captureId);
  const lists = await Promise.all(
    sessions.map((session) => appService.listMessages(session.id)),
  );
  const messages = lists.flat();

  const observations: Observation[] = [];
  let next = 0;
  const worker = async () => {
    while (next < messages.length) {
      const index = next;
      next += 1;
      try {
        const list = await appService.listObservations(messages[index].id);
        observations.push(...list);
      } catch {
        // Наблюдения одного сообщения не должны ронять сохранение.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SAVE_POOL, Math.max(messages.length, 1)) }, () =>
      worker(),
    ),
  );

  return {
    observations,
    sessionsCount: sessions.length,
    messagesCount: messages.length,
  };
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  view: "projects",
  activeProjectId: null,
  projects: [],
  busy: false,
  saving: false,
  error: null,

  loadProjects() {
    set({ projects: readIndex().sort(byUpdatedDesc) });
  },

  clearError() {
    set({ error: null });
  },

  async createProject(name) {
    const trimmed = name.trim();
    const now = new Date().toISOString();
    const meta: ProjectMeta = {
      id: nextProjectId(),
      name: trimmed.length > 0 ? trimmed : "Новый проект",
      createdAt: now,
      updatedAt: now,
      meta: {
        fileName: null,
        sizeBytes: 0,
        sessionCount: 0,
        messageCount: 0,
      },
    };

    const next = persistRecord(get().projects, { meta, data: null });
    if (next === null) {
      set({ error: STORAGE_ERROR });
      return;
    }
    set({ projects: next, error: null });
    await get().openProject(meta.id);
  },

  async importProjectFile(file) {
    set({ busy: true, error: null });

    let record: ProjectRecord;
    try {
      const text = await file.text();
      const data = parseProjectExport(text);
      const now = new Date().toISOString();
      const meta: ProjectMeta = {
        id: nextProjectId(),
        // Имя проекта — из записи внутри файла, иначе из имени файла.
        name: projectTitle(data.capture?.fileName ?? file.name),
        createdAt: now,
        updatedAt: now,
        meta: {
          fileName: data.capture?.fileName ?? null,
          sizeBytes: data.capture?.sizeBytes ?? 0,
          sessionCount: data.capture?.sessionCount ?? 0,
          messageCount: 0,
        },
      };
      record = { meta, data };
    } catch (error) {
      set({
        busy: false,
        error: `Не удалось импортировать проект: ${describeError(error)}`,
      });
      return;
    }

    const next = persistRecord(get().projects, record);
    if (next === null) {
      set({ busy: false, error: STORAGE_ERROR });
      return;
    }

    // Импортированный проект открывается сразу — иначе непонятно, что вышло.
    set({ projects: next, busy: false });
    await get().openProject(record.meta.id);
  },

  async createFromCapture(file) {
    if (get().busy) return;

    // Идём в рабочую зону сразу: там же показывается ход импорта.
    // Проект создаётся только после успешного импорта — файл ещё не прочитан.
    set({
      busy: true,
      error: null,
      activeProjectId: null,
      view: "workspace",
    });

    const app = useAppStore.getState();
    app.resetProject();
    await useAppStore.getState().loadModels();
    await useAppStore.getState().startImport(file);

    const state = useAppStore.getState();
    if (state.importPhase !== "done") {
      // Импорт не удался: проект не создаём, остаёмся в рабочей зоне
      // с сообщением об ошибке и кнопкой «Проекты».
      set({ busy: false });
      return;
    }

    const capture =
      state.captures.find((item) => item.id === state.activeCaptureId) ?? null;
    const now = new Date().toISOString();
    const fileName = capture?.fileName ?? file.name;
    const meta: ProjectMeta = {
      id: nextProjectId(),
      name: projectTitle(fileName),
      createdAt: now,
      updatedAt: now,
      meta: {
        fileName,
        sizeBytes: capture?.sizeBytes ?? file.size,
        sessionCount: capture?.sessionCount ?? 0,
        messageCount: 0,
      },
    };

    const next = persistRecord(get().projects, { meta, data: null });
    if (next === null) {
      set({ busy: false, error: STORAGE_ERROR });
      return;
    }
    set({ projects: next, activeProjectId: meta.id, busy: false, error: null });
    // Свежий проект: прогоняем через общий скоуп, иначе увидит чужие
    // модели и записи из глобальных списков.
    const imported = useAppStore
      .getState()
      .captures.find(
        (item) => item.id === useAppStore.getState().activeCaptureId,
      );
    await useAppStore.getState().applyProjectData({
      ...emptyProjectData(),
      capture: imported ?? null,
      // Скоуп обязан включать запись, иначе applyProjectData вычистит
      // только что импортированную запись пустым списком captures.
      captures: imported ? [captureRefOf(imported)] : [],
    });
  },

  async openDemo() {
    if (get().busy) return;

    const existing = readRecord(DEMO_PROJECT_ID);
    if (existing) {
      await get().openProject(existing.meta.id);
      return;
    }

    set({
      busy: true,
      error: null,
      activeProjectId: DEMO_PROJECT_ID,
      view: "workspace",
    });

    const app = useAppStore.getState();
    app.resetProject();
    await useAppStore.getState().loadProject();

    const state = useAppStore.getState();
    const capture = state.captures[0] ?? null;
    const now = new Date().toISOString();
    const meta: ProjectMeta = {
      id: DEMO_PROJECT_ID,
      name: capture ? projectTitle(capture.fileName) : "Демонстрационный проект",
      createdAt: now,
      updatedAt: now,
      meta: {
        fileName: capture?.fileName ?? null,
        sizeBytes: capture?.sizeBytes ?? 0,
        sessionCount: capture?.sessionCount ?? 0,
        messageCount: 0,
      },
    };

    const next = persistRecord(get().projects, { meta, data: null });
    if (next === null) {
      set({ busy: false, error: STORAGE_ERROR });
      return;
    }
    set({ projects: next, busy: false });
    // Демо без снимка: скоуп как у свежего проекта — только своя запись.
    const demoCapture = useAppStore.getState().captures[0] ?? null;
    await useAppStore.getState().applyProjectData({
      ...emptyProjectData(),
      capture: demoCapture,
      captures: demoCapture ? [captureRefOf(demoCapture)] : [],
    });
  },

  async openProject(id) {
    if (get().busy) return;

    const record = readRecord(id);
    if (!record) {
      set({ error: "Проект не найден — возможно, он был удалён" });
      get().loadProjects();
      return;
    }

    set({ busy: true, error: null, activeProjectId: id, view: "workspace" });

    try {
      const data = await normalizeSnapshot(record.data);
      const emptySnapshot = data === null || isEmptySnapshot(data);
      const needsCapture = Boolean(
        data?.capture ?? record.meta.meta.fileName,
      );

      // Сброс перед загрузкой: следующий проект не должен унаследовать
      // сессии, сообщения и флаги загрузки предыдущего.
      useAppStore.getState().resetProject();

      // Данные запрашиваются заново, если снимок пуст или отсутствует
      // (проект создан, но бэкенд ещё не вернул данные), либо если снимок
      // привязан к записи, но её нет в сервисе. Иначе восстанавливаемся
      // из снимка — без обращения к бэкенду.
      if (emptySnapshot || needsCapture) {
        // selectFirst=false: не показываем первую запись из списка,
        // сразу целимся в запись проекта (иначе вспышка чужих данных).
        await useAppStore.getState().loadProject(false);

        if (needsCapture) {
          // Запись проекта может не найтись в сервисе (например, после
          // переноса на другую машину) — тогда остаётся первая запись.
          const state = useAppStore.getState();
          const wanted = data?.capture?.id;
          const target = wanted
            ? state.captures.find((item) => item.id === wanted)
            : record.meta.meta.fileName
              ? state.captures.find(
                  (item) => item.fileName === record.meta.meta.fileName,
                )
              : undefined;
          if (target && state.activeCaptureId !== target.id) {
            await useAppStore.getState().selectCapture(target.id);
          } else if (!target) {
            // Запись проекта не нашлась: fallback на первую, но осознанно
            // и один раз — без промежуточной вспышки чужой записи.
            const fallback = useAppStore.getState().captures[0];
            if (fallback && useAppStore.getState().activeCaptureId !== fallback.id) {
              await useAppStore.getState().selectCapture(fallback.id);
            }
          }
        }
      } else {
        // Снимок с данными, но без привязки к записи: данные берутся из
        // снимка, повторный запрос к бэкенду не нужен.
        await useAppStore.getState().loadModels();
      }

      // Снимок — истина и для моделей: применяем всегда, даже пустой.
      // Иначе в свежий проект просочатся чужие модели из глобального
      // списка бэкенда (applyProjectData сам их отрежет по снимку).
      await useAppStore.getState().applyProjectData(data ?? emptyProjectData());
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  clearProject(id) {
    // Только тело проекта: индекс (список) не трогаем — запись остаётся.
    removeRecord(id);
    // Рабочая зона гаснет до «Проект не загружен». Ошибку снимаем вручную:
    // resetProject её намеренно не сбрасывает, иначе баннер вернётся.
    useAppStore.getState().resetProject();
    useAppStore.setState({ error: null });
    set({ error: null });
  },

  async backToProjects() {
    if (get().busy || get().saving) return;

    const id = get().activeProjectId;
    if (id === null) {
      set({ view: "projects", error: null });
      return;
    }

    set({ saving: true, error: null });
    let saveError: string | null = null;

    try {
      // Лёгкий снимок тем же форматом, что экспорт проекта (R6.4):
      // модели, наблюдения, настройки, последняя проверка — без байтов.
      const state = useAppStore.getState();
      const capture =
        state.captures.find((item) => item.id === state.activeCaptureId) ??
        null;
      const model =
        state.models?.find((item) => item.id === state.activeModelId) ?? null;
      const { observations, sessionsCount, messagesCount } =
        await collectSaveSnapshot(state.activeCaptureId);

      const snapshot = buildProjectExport(
        {
          generatedAt: new Date().toISOString(),
          capture,
          model,
          models: state.models ?? [],
          sessionsCount,
          messages: [],
          applyByMessage: null,
          opcodes: null,
          observations,
          checkResult: state.checkResult,
        },
        {
          modelId: state.activeModelId,
          sessionId: state.activeSessionId,
          messageId: state.activeMessageId,
          fieldsSource: state.fieldsSource,
          messageModels: state.messageModels,
        },
        // Все записи проекта, а не только активная: иначе повторный вход
        // обрежет список по снапшоту с одним id (см. applyProjectData).
        state.captures,
      );

      const previous = readRecord(id);
      const now = new Date().toISOString();
      const base: ProjectMeta = previous?.meta ?? {
        id,
        name: "Проект",
        createdAt: now,
        updatedAt: now,
        meta: {
          fileName: null,
          sizeBytes: 0,
          sessionCount: 0,
          messageCount: 0,
        },
      };
      const meta: ProjectMeta = {
        ...base,
        updatedAt: now,
        meta: {
          fileName: capture?.fileName ?? base.meta.fileName,
          sizeBytes: capture?.sizeBytes ?? base.meta.sizeBytes,
          sessionCount: sessionsCount,
          messageCount: messagesCount,
        },
      };

      const next = persistRecord(get().projects, { meta, data: snapshot });
      if (next === null) {
        saveError = STORAGE_ERROR;
      } else {
        set({ projects: next });
      }
    } catch (error) {
      saveError = `Не удалось сохранить проект: ${describeError(error)}`;
    } finally {
      // Уходить из проекта можно и с ошибкой сохранения: иначе пользователь
      // заперт в рабочей зоне. Причина показывается баннером на списке.
      set({
        saving: false,
        busy: false,
        view: "projects",
        activeProjectId: null,
        error: saveError,
      });
    }
  },

  deleteProject(id) {
    removeRecord(id);
    const projects = get().projects.filter((item) => item.id !== id);
    writeIndex(projects);
    set((state) => ({
      projects,
      activeProjectId:
        state.activeProjectId === id ? null : state.activeProjectId,
    }));
  },

  async exportProject(id) {
    const record = readRecord(id);
    if (!record) {
      set({ error: "Проект не найден — возможно, он был удалён" });
      get().loadProjects();
      return;
    }
    const data = record.data ?? emptyProjectData();
    await downloadJson(
      projectFileName(record.meta.meta.fileName ?? record.meta.name),
      data,
    );
  },
}));
