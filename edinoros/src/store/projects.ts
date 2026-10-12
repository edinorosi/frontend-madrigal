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
  parseProjectExport,
  projectFileName,
} from "@/src/lib/export/project-export";
import {
  DEMO_PROJECT_ID,
  emptyProjectData,
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
import { useAppStore } from "@/src/store/app";

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
  /** Возврат к списку: автосохранение снимка проекта. */
  backToProjects: () => Promise<void>;
  deleteProject: (id: string) => void;
  /** Скачивание проекта в JSON — тем же форматом, что импорт. */
  exportProject: (id: string) => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
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

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  view: "projects",
  activeProjectId: null,
  projects: [],
  busy: false,
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
    set({ projects: next, busy: false, error: null });
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
      const data = record.data;
      const needsCapture = Boolean(
        data?.capture ?? record.meta.meta.fileName,
      );

      // Сброс перед загрузкой: следующий проект не должен унаследовать
      // сессии, сообщения и флаги загрузки предыдущего.
      useAppStore.getState().resetProject();

      if (needsCapture) {
        await useAppStore.getState().loadProject();

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
        }
      } else {
        // Пустой проект: записи нет, модели нужны — они в снимке.
        await useAppStore.getState().loadModels();
      }

      if (data) {
        await useAppStore.getState().applyProjectData(data);
      }
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  async backToProjects() {
    if (get().busy) return;

    const id = get().activeProjectId;
    if (id === null) {
      set({ view: "projects", error: null });
      return;
    }

    set({ busy: true, error: null });
    let saveError: string | null = null;

    try {
      // Полный снимок тем же путём, что экспорт проекта (R6.4):
      // модели, наблюдения, настройки, последняя проверка.
      const data = await useAppStore.getState().collectExportData();
      const state = useAppStore.getState();

      const snapshot = buildProjectExport(data, {
        modelId: state.activeModelId,
        sessionId: state.activeSessionId,
        messageId: state.activeMessageId,
        fieldsSource: state.fieldsSource,
      });

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
          fileName: data.capture?.fileName ?? base.meta.fileName,
          sizeBytes: data.capture?.sizeBytes ?? base.meta.sizeBytes,
          sessionCount: data.sessionsCount,
          messageCount: data.messages.length,
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

  exportProject(id) {
    const record = readRecord(id);
    if (!record) {
      set({ error: "Проект не найден — возможно, он был удалён" });
      get().loadProjects();
      return;
    }
    const data = record.data ?? emptyProjectData();
    downloadJson(
      projectFileName(record.meta.meta.fileName ?? record.meta.name),
      data,
    );
  },
}));
