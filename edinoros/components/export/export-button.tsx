"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileJson,
  FileText,
  FolderArchive,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadJson, downloadText } from "@/src/lib/export/download";
import {
  ImportFileError,
  buildModelExport,
} from "@/src/lib/export/model-export";
import {
  buildProjectExport,
  modelFileName,
  modelReadmeFileName,
  projectFileName,
  reportFileName,
} from "@/src/lib/export/project-export";
import { buildModelReadme } from "@/src/lib/export/readme-model";
import { buildReportMarkdown } from "@/src/lib/export/report";
import { useAppStore } from "@/src/store/app";

/**
 * Кнопка «Экспорт» (R6) в топбаре: выпадающее меню с экспортом модели,
 * отчёта, проекта и импортом модели/проекта из JSON.
 *
 * Экспорт клиентский: собирает снимок через collectExportData, генерирует
 * файлы чистыми функциями и скачивает их через Blob.
 */
export function ExportButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const importKindRef = useRef<"model" | "project">("model");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Ошибка импорта: показывается модалкой с полным текстом, не обрезкой. */
  const [importError, setImportError] = useState<{
    title: string;
    message: string;
    fileName: string;
    hint: "rule-file" | "model-file" | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3000);
  };

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  const capture = useAppStore(
    (state) =>
      state.captures.find((item) => item.id === state.activeCaptureId) ?? null,
  );
  const activeModel = useAppStore(
    (state) =>
      state.models?.find((item) => item.id === state.activeModelId) ?? null,
  );
  const collectExportData = useAppStore((state) => state.collectExportData);
  const importModel = useAppStore((state) => state.importModel);
  const importProject = useAppStore((state) => state.importProject);
  const openModelEditor = useAppStore((state) => state.openModelEditor);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  // Открытая модалка забирает Esc — как в ConfirmDialog.
  useEffect(() => {
    setOverlayOpen(importError !== null);
  }, [importError, setOverlayOpen]);

  const runExport = async (
    action: () => Promise<void>,
    successText: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      showNotice(successText);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка экспорта");
    } finally {
      setBusy(false);
    }
  };

  const handleExportModel = () =>
    runExport(async () => {
      if (!activeModel) return;
      const json = buildModelExport(activeModel, capture);
      const name = modelFileName(activeModel.name);
      await downloadJson(name, json);
      await downloadText(
        modelReadmeFileName(activeModel.name),
        buildModelReadme(activeModel, name),
        "text/markdown",
      );
    }, "Модель и описание скачаны");

  const handleExportReport = () =>
    runExport(async () => {
      const data = await collectExportData();
      const markdown = buildReportMarkdown(data);
      await downloadText(reportFileName(data.capture?.fileName ?? null), markdown, "text/markdown");
    }, "Отчёт скачан");

  const handleExportProject = () =>
    runExport(async () => {
      const data = await collectExportData();
      const project = buildProjectExport(
        data,
        {
          modelId: useAppStore.getState().activeModelId,
          sessionId: useAppStore.getState().activeSessionId,
          messageId: useAppStore.getState().activeMessageId,
          fieldsSource: useAppStore.getState().fieldsSource,
          messageModels: useAppStore.getState().messageModels,
        },
        // Все записи проекта: без третьего аргумента в файл попадёт
        // только активная запись (дефолт buildProjectExport).
        useAppStore.getState().captures,
      );
      await downloadJson(projectFileName(data.capture?.fileName ?? null), project);
    }, "Проект скачан");

  const handleImportFile = () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    const fileName = file.name;
    const kind = importKindRef.current;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        if (kind === "model") {
          await importModel(file);
        } else {
          await importProject(file);
        }
        showNotice("Импорт завершён");
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Не удалось импортировать файл";
        setImportError({
          title:
            kind === "model"
              ? "Не удалось импортировать модель"
              : "Не удалось импортировать проект",
          message,
          fileName,
          hint: caught instanceof ImportFileError ? caught.hint : null,
        });
      } finally {
        setBusy(false);
      }
    })();
  };

  const copyImportError = () => {
    if (!importError) return;
    void navigator.clipboard
      .writeText(
        `${importError.title}: ${importError.message} (файл: ${importError.fileName})`,
      )
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Буфер обмена недоступен — текст ошибки и так виден в диалоге.
      });
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={() => {
          handleImportFile();
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      {error ? (
        <span
          className="max-w-64 text-[11px] text-destructive whitespace-normal break-words"
          title={error}
        >
          {error}
        </span>
      ) : notice ? (
        <span
          role="status"
          className="max-w-48 truncate text-[11px] text-ok"
          aria-live="polite"
        >
          {notice}
        </span>
      ) : null}
      <DropdownMenu onOpenChange={setOverlayOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy}>
            <Download className="size-4" />
            {busy ? "Экспорт…" : "Экспорт"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem
            disabled={!activeModel || busy}
            onSelect={() => void handleExportModel()}
          >
            <FileJson className="size-4" />
            Модель (JSON)
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => void handleExportReport()}>
            <FileText className="size-4" />
            Отчёт (Markdown)
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => void handleExportProject()}>
            <FolderArchive className="size-4" />
            Проект (JSON)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => {
              importKindRef.current = "model";
              inputRef.current?.click();
            }}
          >
            <Upload className="size-4" />
            Импорт модели (JSON)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => {
              importKindRef.current = "project";
              inputRef.current?.click();
            }}
          >
            <Upload className="size-4" />
            Импорт проекта (JSON)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={importError !== null}
        onOpenChange={(next) => {
          setOverlayOpen(next);
          if (!next) setImportError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{importError?.title}</DialogTitle>
            <DialogDescription>Файл: {importError?.fileName}</DialogDescription>
          </DialogHeader>
          <p className="text-sm break-words">{importError?.message}</p>
          <DialogFooter className="gap-1 sm:justify-end">
            {importError?.hint === "rule-file" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setImportError(null);
                  openModelEditor();
                }}
              >
                Открыть редактор модели
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={copyImportError}>
              {copied ? "Скопировано" : "Скопировать текст"}
            </Button>
            <Button size="sm" onClick={() => setImportError(null)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
