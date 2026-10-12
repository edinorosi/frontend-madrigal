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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadJson, downloadText } from "@/src/lib/export/download";
import { buildModelExport } from "@/src/lib/export/model-export";
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
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

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
      downloadJson(name, json);
      downloadText(
        modelReadmeFileName(activeModel.name),
        buildModelReadme(activeModel, name),
        "text/markdown",
      );
    }, "Модель и описание скачаны");

  const handleExportReport = () =>
    runExport(async () => {
      const data = await collectExportData();
      const markdown = buildReportMarkdown(data);
      downloadText(reportFileName(data.capture?.fileName ?? null), markdown, "text/markdown");
    }, "Отчёт скачан");

  const handleExportProject = () =>
    runExport(async () => {
      const data = await collectExportData();
      const project = buildProjectExport(data, {
        modelId: useAppStore.getState().activeModelId,
        sessionId: useAppStore.getState().activeSessionId,
        messageId: useAppStore.getState().activeMessageId,
        fieldsSource: useAppStore.getState().fieldsSource,
      });
      downloadJson(projectFileName(data.capture?.fileName ?? null), project);
    }, "Проект скачан");

  const handleImportFile = () =>
    runExport(async () => {
      const file = inputRef.current?.files?.[0];
      if (!file) return;
      if (importKindRef.current === "model") {
        await importModel(file);
      } else {
        await importProject(file);
      }
    }, "Импорт завершён");

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
          className="max-w-48 truncate text-[11px] text-destructive"
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
    </>
  );
}
