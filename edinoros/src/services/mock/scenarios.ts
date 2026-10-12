/**
 * ВРЕМЕННЫЙ DEV-МОДУЛЬ. Удаляется вместе с components/dev/ при подключении бэкенда.
 *
 * Пульт управления моком: какой сценарий отдавать, сколько «думать»,
 * ломать ли импорт. В AppService это не протекает — §12 запрещает расширять
 * интерфейс, поэтому настройки живут отдельным модулем рядом с моками,
 * а mockService их только читает.
 */
import { create } from "zustand";
import type { Capture } from "@/src/types/domain";

export type ScenarioId =
  | "default"
  | "empty"
  | "no-sessions"
  | "single-message"
  | "large"
  | "messages-fail";

export interface ScenarioInfo {
  id: ScenarioId;
  title: string;
  description: string;
}

export const SCENARIOS: ScenarioInfo[] = [
  {
    id: "default",
    title: "Обычный проект",
    description: "Запись с тремя сессиями: 30, 1 и 300 сообщений",
  },
  {
    id: "empty",
    title: "Пустой проект",
    description: "Ничего не импортировано",
  },
  {
    id: "no-sessions",
    title: "Нет сессий",
    description: "Запись есть, сессий нет",
  },
  {
    id: "single-message",
    title: "Одна сессия, одно сообщение",
    description: "Минимальный непустой набор",
  },
  {
    id: "large",
    title: "Сессия на 300 сообщений",
    description: "Проверка виртуализации списка",
  },
  {
    id: "messages-fail",
    title: "Ошибка загрузки сообщений",
    description: "listMessages падает — список показывает «Повторить»",
  },
];

export interface MockSettings {
  scenario: ScenarioId;
  /** Искусственная задержка ответа, мс. Показывает скелетоны. */
  latencyMs: number;
  /** Длительность имитации импорта, мс. */
  importDurationMs: number;
  /** Импорт падает с ошибкой разбора. */
  importFails: boolean;
  /** Записи, добавленные через импорт в текущей сессии. */
  importedCaptures: Capture[];
}

interface MockSettingsStore extends MockSettings {
  setScenario: (scenario: ScenarioId) => void;
  setLatency: (latencyMs: number) => void;
  setImportDuration: (importDurationMs: number) => void;
  setImportFails: (importFails: boolean) => void;
  addImportedCapture: (capture: Capture) => void;
  clearImportedCaptures: () => void;
  reset: () => void;
}

/**
 * Записи, импортированные в моке, переживают перезагрузку страницы:
 * иначе проект, созданный из PCAP, после перезагрузки не нашёл бы свою
 * запись. Пишется только в dev-моде — вместе с этим модулем исчезнет.
 */
const IMPORTED_CAPTURES_KEY = "edinoros-mock-captures";

function readImportedCaptures(): Capture[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(IMPORTED_CAPTURES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Capture =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).fileName === "string",
    );
  } catch {
    return [];
  }
}

function writeImportedCaptures(list: Capture[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IMPORTED_CAPTURES_KEY, JSON.stringify(list));
  } catch {
    // Хранилище недоступно — записи живут до перезагрузки, как раньше.
  }
}

const INITIAL: MockSettings = {
  scenario: "default",
  latencyMs: 120,
  importDurationMs: 1400,
  importFails: false,
  importedCaptures: readImportedCaptures(),
};

export const useMockSettings = create<MockSettingsStore>((set) => ({
  ...INITIAL,
  setScenario: (scenario) => set({ scenario }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setImportDuration: (importDurationMs) => set({ importDurationMs }),
  setImportFails: (importFails) => set({ importFails }),
  addImportedCapture: (capture) =>
    set((state) => {
      const importedCaptures = [...state.importedCaptures, capture];
      writeImportedCaptures(importedCaptures);
      return { importedCaptures };
    }),
  clearImportedCaptures: () => {
    writeImportedCaptures([]);
    set({ importedCaptures: [] });
  },
  reset: () => set({ ...INITIAL }),
}));

/** Чтение настроек вне React — так их использует mockService. */
export function readMockSettings(): MockSettings {
  const {
    scenario,
    latencyMs,
    importDurationMs,
    importFails,
    importedCaptures,
  } = useMockSettings.getState();

  return {
    scenario,
    latencyMs,
    importDurationMs,
    importFails,
    importedCaptures,
  };
}

/** Зафиксировать запись, добавленную импортом. */
export function recordImportedCapture(capture: Capture): void {
  useMockSettings.getState().addImportedCapture(capture);
}
