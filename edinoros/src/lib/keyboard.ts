/** Помощники клавиатуры для глобальных обработчиков. */

/**
 * Источник события — поле ввода или contenteditable.
 * Глобальные Esc-обработчики должны пропускать такие события: пользователь
 * завершает ввод, а не закрывает панель.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}
