"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { SidebarPanel } from "@/components/layout/sidebar-panel";
import { Statusbar } from "@/components/layout/statusbar";
import { Topbar } from "@/components/layout/topbar";
import { WorkArea } from "@/components/layout/work-area";
import { ModelEditor } from "@/components/model/model-editor";
import { StaleWarningDialog } from "@/components/model/stale-warning-dialog";
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

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

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
      <DevMenu />
    </div>
  );
}
