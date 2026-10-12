"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SidebarPanel } from "@/components/layout/sidebar-panel";
import { Statusbar } from "@/components/layout/statusbar";
import { Topbar } from "@/components/layout/topbar";
import { WorkArea } from "@/components/layout/work-area";
import { ModelEditor } from "@/components/model/model-editor";
import { StaleWarningDialog } from "@/components/model/stale-warning-dialog";
import { PatternDialog } from "@/components/import/pattern-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAppStore } from "@/src/store/app";

/**
 * Тестовое меню подключается только в dev-сборке и отдельным чанком:
 * в production-сборке ветка статически ложна, поэтому код пульта
 * в бандл не попадает и связаться с бэкендом не мешает.
 */
const DevMenu =
  process.env.NODE_ENV !== "production"
    ? dynamic(() =>
        import("@/components/dev/dev-menu").then((module) => module.DevMenu),
      )
    : () => null;

export default function Page() {
  const loadProject = useAppStore((state) => state.loadProject);
  const modelEditorOpen = useAppStore((state) => state.modelEditorOpen);
  const setSidebarCollapsed = useAppStore(
    (state) => state.setSidebarCollapsed,
  );
  const startImport = useAppStore((state) => state.startImport);
  const isMobile = useIsMobile();

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  // На узких экранах список свёрнут по умолчанию; пользователь может открыть
  // его кнопкой в шапке — эффект реагирует только на смену ширины.
  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true);
  }, [isMobile, setSidebarCollapsed]);

  // Перетаскивание файла на окно — альтернатива диалогу «Загрузить PCAP».
  // Валидация расширения/размера — внутри startImport.
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragOver(true);
    };

    const onDragLeave = (event: DragEvent) => {
      // Выход за пределы окна (relatedTarget = null), а не внутри него.
      if (event.relatedTarget !== null) return;
      setDragOver(false);
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void startImport(file);
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [startImport]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Topbar />
      {modelEditorOpen ? (
        <ModelEditor />
      ) : (
        <div className="flex min-h-0 flex-1">
          <SidebarPanel />
          <WorkArea />
        </div>
      )}
      <Statusbar />
      <StaleWarningDialog />
      <PatternDialog />
      <DevMenu />

      {dragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/60">
          <div className="rounded-lg border-2 border-dashed border-primary bg-background px-10 py-7 text-sm shadow-lg">
            Отпустите, чтобы загрузить запись PCAP
          </div>
        </div>
      ) : null}
    </div>
  );
}
