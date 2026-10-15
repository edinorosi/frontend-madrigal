"use client";

import { useEffect, useState } from "react";
import { SidebarPanel } from "@/components/layout/sidebar-panel";
import { Statusbar } from "@/components/layout/statusbar";
import { Topbar } from "@/components/layout/topbar";
import { WorkArea } from "@/components/layout/work-area";
import { ModelEditor } from "@/components/model/model-editor";
import { StaleWarningDialog } from "@/components/model/stale-warning-dialog";
import { PatternDialog } from "@/components/import/pattern-dialog";
import { InferDialog } from "@/components/model/infer-dialog";
import { ProjectsScreen } from "@/components/projects/projects-screen";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAppStore } from "@/src/store/app";
import { useProjectsStore } from "@/src/store/projects";

const CAPTURE_EXT = [".pcap", ".pcapng", ".cap"];

export default function Page() {
  const view = useProjectsStore((state) => state.view);
  const importProjectFile = useProjectsStore(
    (state) => state.importProjectFile,
  );
  const createFromCapture = useProjectsStore(
    (state) => state.createFromCapture,
  );
  const modelEditorOpen = useAppStore((state) => state.modelEditorOpen);
  const setSidebarCollapsed = useAppStore(
    (state) => state.setSidebarCollapsed,
  );
  const startImport = useAppStore((state) => state.startImport);
  const isMobile = useIsMobile();

  // На узких экранах список свёрнут по умолчанию; пользователь может открыть
  // его кнопкой в шапке — эффект реагирует только на смену ширины.
  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true);
  }, [isMobile, setSidebarCollapsed]);

  // Перетаскивание файла на окно — альтернатива диалогам выбора файла.
  // На стартовой странице файл создаёт проект, в рабочей зоне — загружает
  // запись в открытый проект. Валидация — внутри startImport/разбора проекта.
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
      if (!file) return;

      if (view !== "projects") {
        void startImport(file);
        return;
      }

      const name = file.name.toLowerCase();
      if (name.endsWith(".json")) void importProjectFile(file);
      else if (CAPTURE_EXT.some((ext) => name.endsWith(ext))) {
        void createFromCapture(file);
      }
      // Прочие файлы на стартовой странице — молча игнорируются.
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [view, startImport, importProjectFile, createFromCapture]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {view === "projects" ? (
        <ProjectsScreen />
      ) : (
        <>
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
          <InferDialog />
        </>
      )}

      {dragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/60">
          <div className="rounded-lg border-2 border-dashed border-primary bg-background px-10 py-7 text-sm shadow-lg">
            {view === "projects"
              ? "Отпустите, чтобы создать проект из PCAP или JSON"
              : "Отпустите, чтобы загрузить запись PCAP"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
