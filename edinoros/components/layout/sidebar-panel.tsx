"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { MessageList } from "@/components/sidebar/message-list";
import { SessionList } from "@/components/sidebar/session-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isTypingTarget } from "@/src/lib/keyboard";
import {
  useAppStore,
  SIDEBAR_WIDTH_KEY,
  type SidebarTab,
} from "@/src/store/app";

/**
 * Перетаскивание правой границы сайдбара. Только pointer capture, без
 * слушателей на window: startX/startWidth фиксируются на pointerdown.
 * pointermove лишь копит координату, ширина пишется один раз за кадр (rAF).
 */
function useSidebarResize() {
  const width = useAppStore((state) => state.sidebarWidth);
  const setSidebarWidth = useAppStore((state) => state.setSidebarWidth);
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const xRef = useRef(0);
  const [resizing, setResizing] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, width };
    xRef.current = event.clientX;
    setResizing(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startRef.current === null) return;
    xRef.current = event.clientX;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const start = startRef.current;
      if (start === null) return;
      setSidebarWidth(start.width + (xRef.current - start.x));
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (start === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    startRef.current = null;
    setSidebarWidth(start.width + (event.clientX - start.x));
    requestAnimationFrame(() => setResizing(false));
  };

  return { resizing, onPointerDown, onPointerMove, onPointerUp };
}

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
  const sidebarWidth = useAppStore((state) => state.sidebarWidth);
  const resize = useSidebarResize();

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

  // Ширина сохраняется в localStorage с debounce (~175 мс), а не на каждый
  // кадр drag: setSidebarWidth теперь меняет только состояние стора.
  const persistReadyRef = useRef(false);
  useEffect(() => {
    if (!persistReadyRef.current) {
      persistReadyRef.current = true;
      return;
    }
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
      } catch {
        // Приватный режим/лимит хранилища — ширина просто не сохранится.
      }
    }, 175);
    return () => window.clearTimeout(id);
  }, [sidebarWidth]);

  return (
    <>
      <aside
        // Свёрнутая панель скрыта и выключена из порядка табуляции.
        inert={collapsed}
        data-sidebar
        style={collapsed ? undefined : { width: sidebarWidth }}
        className={cn(
          "flex shrink-0 flex-col overflow-hidden border-r bg-sidebar",
          // Во время drag ширину не анимируем: иначе панель догоняет курсор.
          !resize.resizing && "transition-[width,max-width,min-width] duration-200",
          collapsed && "w-0 min-w-0 max-w-0 border-r-0",
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

      {collapsed ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину списка"
          tabIndex={-1}
          onPointerDown={resize.onPointerDown}
          onPointerMove={resize.onPointerMove}
          onPointerUp={resize.onPointerUp}
          onPointerCancel={resize.onPointerUp}
          className="w-1 shrink-0 cursor-col-resize select-none transition-colors hover:bg-accent/50"
        />
      )}
    </>
  );
}
