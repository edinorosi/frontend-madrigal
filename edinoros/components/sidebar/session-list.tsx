"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { EmptyHint } from "@/components/empty-hint";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClock, formatDate, formatTuple } from "@/src/lib/format";
import { useAppStore } from "@/src/store/app";

const ROW_HEIGHT = 60;

/**
 * Список сессий (§5): 4-tuple, количество сообщений, время начала.
 * Виртуализирован: сессий может быть много.
 */
export function SessionList() {
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const hasCapture = useAppStore((state) => state.activeCaptureId !== null);
  const loading = useAppStore((state) => state.loading.sessions);
  const selectSession = useAppStore((state) => state.selectSession);
  const setSidebarTab = useAppStore((state) => state.setSidebarTab);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!hasCapture) {
    return <EmptyHint>Запись не выбрана</EmptyHint>;
  }

  if (sessions.length === 0) {
    return <EmptyHint>Нет данных — в записи не найдено ни одной сессии</EmptyHint>;
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const session = sessions[row.index];
          const active = session.id === activeSessionId;

          return (
            <button
              key={row.key}
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => {
                // Сессия выбрана — сразу показываем её сообщения, а не список.
                setSidebarTab("messages");
                void selectSession(session.id);
              }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
              className={cn(
                "flex flex-col justify-center gap-1 border-b border-border/60 px-2.5 text-left",
                "transition-colors hover:bg-sidebar-accent",
                active && "bg-sidebar-accent",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "truncate font-mono text-[11px]",
                    active ? "text-sidebar-accent-foreground" : undefined,
                  )}
                >
                  {formatTuple(session.tuple)}
                </span>
                <Badge
                  variant="secondary"
                  className="shrink-0 px-1.5 font-mono text-[10px]"
                >
                  {session.messageCount}
                </Badge>
              </span>
              <span className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="font-mono">
                  {formatClock(session.startedAt)}
                </span>
                <span>{formatDate(session.startedAt)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
