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
  | "large";

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

const INITIAL: MockSettings = {
  scenario: "default",
  latencyMs: 120,
  importDurationMs: 1400,
  importFails: false,
  importedCaptures: [],
};

export const useMockSettings = create<MockSettingsStore>((set) => ({
  ...INITIAL,
  setScenario: (scenario) => set({ scenario }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setImportDuration: (importDurationMs) => set({ importDurationMs }),
  setImportFails: (importFails) => set({ importFails }),
  addImportedCapture: (capture) =>
    set((state) => ({ importedCaptures: [...state.importedCaptures, capture] })),
  clearImportedCaptures: () => set({ importedCaptures: [] }),
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
