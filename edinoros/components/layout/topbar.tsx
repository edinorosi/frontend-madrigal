"use client";

import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ExportButton } from "@/components/export/export-button";
import { ImportButton } from "@/components/import-button";
import { ScriptButton } from "@/components/scripts/script-dialog";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { captureTitle, formatBytes } from "@/src/lib/format";
import { useAppStore } from "@/src/store/app";
import { useProjectsStore } from "@/src/store/projects";

export function Topbar() {
  const capture = useAppStore(
    (state) =>
      state.captures.find((item) => item.id === state.activeCaptureId) ?? null,
  );
  const captures = useAppStore((state) => state.captures);
  const activeCaptureId = useAppStore((state) => state.activeCaptureId);
  const selectCapture = useAppStore((state) => state.selectCapture);

  const backToProjects = useProjectsStore((state) => state.backToProjects);
  const leaving = useProjectsStore((state) => state.busy);
  const saving = useProjectsStore((state) => state.saving);

  const compareMessageId = useAppStore((state) => state.compareMessageId);
  const activeMessageNumber = useAppStore(
    (state) =>
      state.messages.find((item) => item.id === state.activeMessageId)
        ?.packetNumber ?? null,
  );
  const compareMessageNumber = useAppStore(
    (state) =>
      state.messages.find((item) => item.id === state.compareMessageId)
        ?.packetNumber ?? null,
  );
  const stopCompare = useAppStore((state) => state.stopCompare);
  const activeModel = useAppStore(
    (state) =>
      state.models?.find((item) => item.id === state.activeModelId) ?? null,
  );
  const modelEditorOpen = useAppStore((state) => state.modelEditorOpen);
  const openModelEditor = useAppStore((state) => state.openModelEditor);
  const closeModelEditor = useAppStore((state) => state.closeModelEditor);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);

  const compareActive = compareMessageId !== null;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-sidebar px-3">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 px-2"
        disabled={leaving || saving}
        title="Сохранить проект и вернуться к списку"
        onClick={() => void backToProjects()}
      >
        <ArrowLeft className="size-4" />
        {saving ? "Сохранение…" : "Проекты"}
      </Button>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 px-0"
        title={sidebarCollapsed ? "Показать список" : "Скрыть список"}
        aria-label={sidebarCollapsed ? "Показать список" : "Скрыть список"}
        aria-expanded={!sidebarCollapsed}
        onClick={toggleSidebar}
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen className="size-4" />
        ) : (
          <PanelLeftClose className="size-4" />
        )}
      </Button>
      <div className="flex min-w-0 items-center gap-2">
        {captures.length > 1 ? (
          <Select
            value={activeCaptureId ?? undefined}
            onValueChange={(value) => void selectCapture(value)}
          >
            <SelectTrigger
              size="sm"
              className="h-6 max-w-56 border-transparent bg-transparent px-1.5 font-medium hover:bg-sidebar-accent"
              aria-label="Активная запись"
              title="Переключиться между записями"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {captures.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <span className="truncate">{captureTitle(item)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="truncate text-sm font-medium">
            {captureTitle(capture)}
          </span>
        )}
        {capture ? (
          <Badge
            variant="secondary"
            className="shrink-0 font-mono text-[11px]"
            title={`Импортировано ${capture.importedAt}`}
          >
            {formatBytes(capture.sizeBytes)}
          </Badge>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          className="h-5 shrink-0 px-2 font-mono text-[11px]"
          title="Редактор модели"
          onClick={() =>
            modelEditorOpen ? closeModelEditor() : openModelEditor()
          }
        >
          Модель: {activeModel ? activeModel.name : "—"}
        </Button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {compareActive ? (
          <>
            <div className="flex items-center gap-1.5 rounded border border-diff/40 bg-diff/10 py-0.5 pr-0.5 pl-2">
              <span className="font-mono text-[11px]">
                Сравнение: №{activeMessageNumber ?? "—"} ↔ №
                {compareMessageNumber ?? "—"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={stopCompare}
              >
                Закрыть
              </Button>
            </div>
            <Separator orientation="vertical" className="mx-1 h-5" />
          </>
        ) : null}
        <ExportButton />
        <ImportButton size="sm" variant="outline" />
        <ScriptButton />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ThemeToggle />
      </div>
    </header>
  );
}
