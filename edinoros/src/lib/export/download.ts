/**
 * Скачивание файлов (R6).
 *
 * Браузер: Blob + a.click(), как раньше.
 * Tauri: нативный диалог сохранения + запись через FS-плагин —
 * в webview якорные закачки молча глохнут, поэтому ветка отдельная.
 * Ошибки (включая отмену вне scope FS) кидаются текстом наверх.
 */

async function isTauriApp(): Promise<boolean> {
  try {
    const { isTauri } = await import("@tauri-apps/api/core");
    return await isTauri();
  } catch {
    return false;
  }
}

async function saveViaTauri(
  fileName: string,
  write: (path: string) => Promise<void>,
): Promise<void> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({ defaultPath: fileName });
  if (!picked) return;
  await write(picked);
}

/** Скачивание текстового файла. */
export async function downloadText(
  fileName: string,
  content: string,
  mime: string,
): Promise<void> {
  if (await isTauriApp()) {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await saveViaTauri(fileName, (path) => writeTextFile(path, content));
    return;
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Скачивание значения в формате JSON (отступ 2 пробела, с переводом строки). */
export async function downloadJson(
  fileName: string,
  value: unknown,
): Promise<void> {
  await downloadText(
    fileName,
    `${JSON.stringify(value, null, 2)}\n`,
    "application/json",
  );
}

/** Скачивание бинарных данных (для tar.gz из бэкенда). */
export async function downloadBytes(
  fileName: string,
  data: Uint8Array,
): Promise<void> {
  if (await isTauriApp()) {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await saveViaTauri(fileName, (path) => writeFile(path, data));
    return;
  }
  const blob = new Blob([data as unknown as BlobPart], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Имя файла из свободного текста: символы, запрещённые в именах файлов
 * (Windows и Linux), заменяются на «-». Пустой результат — «export».
 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return cleaned.length > 0 ? cleaned : "export";
}
