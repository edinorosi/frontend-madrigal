import type { Capture, Message, SessionTuple } from "@/src/types/domain";

/**
 * Время форматируется в UTC прямо из строки ISO, без toLocale*.
 * Иначе пререндер на сборочной машине и гидратация в браузере пользователя
 * дали бы разное время и расхождение разметки.
 */
export function formatClock(iso: string): string {
  return iso.slice(11, 23);
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КиБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МиБ`;
}

export function formatTuple(tuple: SessionTuple): string {
  const { source, destination } = tuple;
  return `${source.address}:${source.port} → ${destination.address}:${destination.port}`;
}

export function formatShortTuple(tuple: SessionTuple): string {
  const { source, destination } = tuple;
  return `${source.address}:${source.port} → :${destination.port}`;
}

export function captureTitle(capture: Capture | null): string {
  return capture ? capture.fileName : "Проект не загружен";
}

/** Доля разобранных сообщений — покрытие модели в статусбаре. */
export function coverageOf(messages: Message[]): number | null {
  if (messages.length === 0) return null;
  const parsed = messages.filter((message) => message.status === "parsed").length;
  return parsed / messages.length;
}

export function anomaliesOf(messages: Message[]): number {
  return messages.filter((message) => message.status !== "parsed").length;
}
