"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeftRight,
  Copy,
  FileSearch,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/src/lib/keyboard";
import { EmptyHint } from "@/components/empty-hint";
import {
  HexContextMenu,
  type HexContextMenuItem,
} from "@/components/hex/hex-context-menu";
import { MessageRow } from "@/components/sidebar/message-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClock, formatBytes } from "@/src/lib/format";
import { toHexText } from "@/src/lib/hex";
import { useAppStore } from "@/src/store/app";
import type { Direction, Message, ParseStatus } from "@/src/types/domain";

const ROW_HEIGHT = 52;
/** Сколько держать обратную связь в меню перед закрытием. */
const NOTICE_MS = 700;

interface MenuState {
  messageId: string;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
}

/**
 * Список сообщений выбранной сессии (§5). Виртуализирован: сообщений бывают сотни.
 * ПКМ по сообщению: сравнить, открыть, скопировать, показать пакет.
 */
export function MessageList() {
  const messages = useAppStore((state) => state.messages);
  const activeMessageId = useAppStore((state) => state.activeMessageId);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const messagesError = useAppStore((state) => state.messagesError);
  const loading = useAppStore((state) => state.loading.messages);
  const selectMessage = useAppStore((state) => state.selectMessage);
  const selectSession = useAppStore((state) => state.selectSession);
  const startCompare = useAppStore((state) => state.startCompare);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);
  const pulseSource = useAppStore((state) => state.pulseSource);
  const getMessageBytes = useAppStore((state) => state.getMessageBytes);
  const bytesA = useAppStore((state) => state.bytes);
  const bytesALoading = useAppStore((state) => state.loading.bytes);

  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"all" | Direction>("all");
  const [status, setStatus] = useState<"all" | ParseStatus>("all");

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuNotice, setMenuNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

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

  const closeMenu = useCallback(() => {
    setMenuNotice(null);
    setMenu(null);
    setOverlayOpen(false);
  }, [setOverlayOpen]);

  const showNotice = useCallback(
    (text: string) => {
      setMenuNotice(text);

      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }

      noticeTimerRef.current = window.setTimeout(() => {
        setMenuNotice(null);
        setMenu(null);
        setOverlayOpen(false);
      }, NOTICE_MS);
    },
    [setOverlayOpen],
  );

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  // Esc закрывает ПКМ: hex-dump при этом пропускает клавишу — меню держит overlayOpen.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc из поля ввода завершает ввод (фильтры), а не закрывает меню.
      if (isTypingTarget(event.target)) return;
      if (menu) closeMenu();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, closeMenu]);

  const copyMessageHex = useCallback(
    async (message: Message) => {
      if (!navigator.clipboard) {
        showNotice("Буфер обмена недоступен");
        return;
      }

      try {
        const bytes = await getMessageBytes(message.id);
        await navigator.clipboard.writeText(toHexText(bytes));
        showNotice(`Скопировано: ${bytes.length} байт`);
      } catch {
        showNotice("Не удалось скопировать");
      }
    },
    [getMessageBytes, showNotice],
  );

  const menuItems = useMemo<HexContextMenuItem[]>(() => {
    if (!menu) return [];

    const target = messages.find((item) => item.id === menu.messageId);
    if (!target) return [];

    const items: HexContextMenuItem[] = [];

    // «Сравнить с текущим» — та же логика, что у кнопки «Сравнить с…»,
    // но точка входа обратная: сообщение из меню — B, текущий A — из стора.
    const canCompare =
      messages.length > 1 &&
      activeMessageId !== null &&
      target.id !== activeMessageId &&
      bytesA !== null &&
      !bytesALoading;

    if (canCompare) {
      items.push({
        id: "compare",
        label: "Сравнить с текущим",
        icon: ArrowLeftRight,
        onSelect: () => {
          closeMenu();
          void startCompare(target.id);
        },
      });
    }

    if (target.id !== activeMessageId) {
      items.push({
        id: "open",
        label: "Открыть",
        icon: FolderOpen,
        onSelect: () => {
          closeMenu();
          void selectMessage(target.id);
        },
      });
    }

    items.push({
      id: "copy",
      label: "Копировать как hex",
      icon: Copy,
      onSelect: () => void copyMessageHex(target),
    });

    items.push({
      id: "source",
      label: "Показать в пакете",
      icon: FileSearch,
      onSelect: () => {
        closeMenu();
        // Чип в шапке показывает номер активного сообщения: для чужого
        // сначала открываем его, чтобы пульс вёл на нужный пакет.
        if (target.id === activeMessageId) {
          pulseSource();
        } else {
          void selectMessage(target.id).then(() => pulseSource());
        }
      },
    });

    return items;
  }, [
    menu,
    messages,
    activeMessageId,
    bytesA,
    bytesALoading,
    closeMenu,
    startCompare,
    selectMessage,
    copyMessageHex,
    pulseSource,
  ]);

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      // Клик правой кнопкой вне строки — не показываем и системное меню не оставляем.
      event.preventDefault();

      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-message-id]",
      );
      const messageId = target?.dataset.messageId;
      if (!messageId) return;

      const scrollEl = scrollRef.current;
      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();

      setMenuNotice(null);
      setOverlayOpen(true);
      setMenu({
        messageId,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        containerWidth: scrollEl.clientWidth,
        containerHeight: scrollEl.clientHeight,
      });
    },
    [setOverlayOpen],
  );

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

  // Баг С.7: при сбое загрузки не показываем ложное «нет сообщений».
  if (messagesError) {
    return (
      <div className="flex flex-col items-start gap-2 p-2">
        <p className="text-xs text-destructive">{messagesError}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void selectSession(activeSessionId)}
        >
          <RefreshCw className="size-3.5" />
          Повторить
        </Button>
      </div>
    );
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
          aria-label="Поиск по метке"
          className="h-7 text-xs"
        />
        <div className="flex gap-1.5">
          <Select
            value={direction}
            onValueChange={(value) => setDirection(value as "all" | Direction)}
          >
            <SelectTrigger
              size="sm"
              className="h-7 flex-1 text-xs"
              aria-label="Направление"
            >
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
            <SelectTrigger
              size="sm"
              className="h-7 flex-1 text-xs"
              aria-label="Статус разбора"
            >
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
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onContextMenu={handleContextMenu}
            className="h-full overflow-auto"
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((row) => {
                const message = filtered[row.index];
                const active = message.id === activeMessageId;

                return (
                  <button
                    key={row.key}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    data-message-id={message.id}
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
                    <MessageRow message={message} />

                    <span className="flex items-center justify-between pl-8 text-[10px] text-muted-foreground">
                      <span className="font-mono">{formatBytes(message.length)}</span>
                      <span className="font-mono">
                        {formatClock(message.timestamp)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {menu ? (
            <HexContextMenu
              position={{ x: menu.x, y: menu.y }}
              containerWidth={menu.containerWidth}
              containerHeight={menu.containerHeight}
              items={menuItems}
              notice={menuNotice}
              onClose={closeMenu}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
