"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyHint } from "@/components/empty-hint";
import { StatusIcon } from "@/components/status-icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClock } from "@/src/lib/format";
import { useAppStore } from "@/src/store/app";
import type { Direction, MessageRole, ParseStatus } from "@/src/types/domain";

const ROW_HEIGHT = 52;

const ROLE_TONE: Record<MessageRole, string> = {
  REQ: "bg-primary/10 text-primary",
  RSP: "bg-muted text-muted-foreground",
  NOTIFY: "bg-warn/15 text-warn",
};

const ROLE_TITLE: Record<MessageRole, string> = {
  REQ: "Запрос",
  RSP: "Ответ",
  NOTIFY: "Уведомление",
};

/** Список сообщений выбранной сессии (§5). Виртуализирован: сообщений бывают сотни. */
export function MessageList() {
  const messages = useAppStore((state) => state.messages);
  const activeMessageId = useAppStore((state) => state.activeMessageId);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const loading = useAppStore((state) => state.loading.messages);
  const selectMessage = useAppStore((state) => state.selectMessage);

  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"all" | Direction>("all");
  const [status, setStatus] = useState<"all" | ParseStatus>("all");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return messages.filter((message) => {
      if (direction !== "all" && message.direction !== direction) return false;
      if (status !== "all" && message.status !== status) return false;
      if (needle && !message.label.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [messages, query, direction, status]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (!activeSessionId) {
    return <EmptyHint>Выберите сессию, чтобы увидеть её сообщения</EmptyHint>;
  }

  if (messages.length === 0) {
    return <EmptyHint>В этой сессии нет сообщений</EmptyHint>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-1.5 border-b p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по метке"
          className="h-7 text-xs"
        />
        <div className="flex gap-1.5">
          <Select
            value={direction}
            onValueChange={(value) => setDirection(value as "all" | Direction)}
          >
            <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все направления</SelectItem>
              <SelectItem value="request">→ запросы</SelectItem>
              <SelectItem value="response">← ответы</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(value) => setStatus(value as "all" | ParseStatus)}
          >
            <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Любой статус</SelectItem>
              <SelectItem value="parsed">Разобрано</SelectItem>
              <SelectItem value="unknown">Неизвестно</SelectItem>
              <SelectItem value="error">Ошибка</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyHint>Ничего не найдено по текущему фильтру</EmptyHint>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const message = filtered[row.index];
              const active = message.id === activeMessageId;
              const isRequest = message.direction === "request";

              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => void selectMessage(message.id)}
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
                  <div className="flex items-center gap-1.5">
                    {isRequest ? (
                      <ArrowRight
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-label="Запрос"
                      />
                    ) : (
                      <ArrowLeft
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-label="Ответ"
                      />
                    )}
                    <span
                      title={ROLE_TITLE[message.role]}
                      className={cn(
                        "shrink-0 rounded px-1 py-px font-mono text-[9px] leading-tight",
                        ROLE_TONE[message.role],
                      )}
                    >
                      {message.role}
                    </span>
                    <span className="truncate font-mono text-[11px]">
                      {message.label}
                    </span>
                    <StatusIcon status={message.status} className="ml-auto" />
                  </div>

                  <div className="flex items-center justify-between pl-4.5 text-[10px] text-muted-foreground">
                    <span className="font-mono">{message.length} Б</span>
                    <span className="font-mono">
                      {formatClock(message.timestamp)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
