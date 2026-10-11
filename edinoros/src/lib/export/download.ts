/**
 * Скачивание файлов из браузера (R6).
 *
 * Клиентский экспорт: Blob +.createObjectURL + a.click(). Без зависимостей,
 * без Node API — работает в статической сборке.
 */

/** Скачивание текстового файла. */
export function downloadText(
  fileName: string,
  content: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Скачивание значения в формате JSON (отступ 2 пробела, с переводом строки). */
export function downloadJson(fileName: string, value: unknown): void {
  downloadText(fileName, `${JSON.stringify(value, null, 2)}\n`, "application/json");
}

/**
 * Имя файла из свободного текста: символы, запрещённые в именах файлов
 * (Windows и Linux), заменяются на «-». Пустой результат — «export».
 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return cleaned.length > 0 ? cleaned : "export";
}
