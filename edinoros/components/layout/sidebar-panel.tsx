"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { MessageList } from "@/components/sidebar/message-list";
import { SessionList } from "@/components/sidebar/session-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isTypingTarget } from "@/src/lib/keyboard";
import { useAppStore, type SidebarTab } from "@/src/store/app";

/** Левая панель: два таба — сессии и сообщения (§5). */
export function SidebarPanel() {
  const tab = useAppStore((state) => state.sidebarTab);
  const setSidebarTab = useAppStore((state) => state.setSidebarTab);
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore(
    (state) => state.setSidebarCollapsed,
  );
  const focusMessageFilter = useAppStore(
    (state) => state.focusMessageFilter,
  );

  // Ctrl+F — фильтр сообщений: открываем таб и просим список забрать фокус.
  // Если фокус в HEX-дампе — там свой поиск (Ctrl+F обрабатывает дамп).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f"))
        return;
      if (isTypingTarget(event.target)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-hex-root]") !== null
      ) {
        return;
      }

      event.preventDefault();
      setSidebarCollapsed(false);
      setSidebarTab("messages");
      focusMessageFilter();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSidebarCollapsed, setSidebarTab, focusMessageFilter]);

  return (
    <aside
      // Свёрнутая панель скрыта и выключена из порядка табуляции.
      inert={collapsed}
      data-sidebar
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-r bg-sidebar",
        "transition-[width,max-width,min-width] duration-200",
        collapsed
          ? "w-0 min-w-0 max-w-0 border-r-0"
          : "w-[25%] max-w-[320px] min-w-[280px]",
      )}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setSidebarTab(value as SidebarTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="sessions" className="flex-1">
              Сессии
            </TabsTrigger>
            <TabsTrigger value="messages" className="flex-1">
              Сообщения
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="sessions" className="min-h-0 flex-1">
          <SessionList />
        </TabsContent>

        <TabsContent value="messages" className="min-h-0 flex-1">
          <MessageList />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
