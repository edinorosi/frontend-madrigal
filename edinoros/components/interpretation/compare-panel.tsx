"use client";

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { computeDiff, type DiffTail } from "@/src/lib/diff";
import { formatBytes } from "@/src/lib/format";
import { useAppStore } from "@/src/store/app";
import type { Message } from "@/src/types/domain";

const ROW_HEIGHT = 34;

function caption(message: Message): string {
  return `№${message.packetNumber}`;
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-muted-foreground">{name}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}

/** Хвост — разница длин. В дампе A его нет, если длиннее оказалось B. */
function TailCard({
  tail,
  onSelect,
}: {
  tail: DiffTail;
  onSelect: () => void;
}) {
  const text = `байты ${tail.offsetStart}–${tail.offsetStart + tail.length - 1}`;
  const inA = tail.longer === "A";

  return (
    <button
      type="button"
      disabled={!inA}
      onClick={onSelect}
      className={cn(
        "flex w-full shrink-0 items-center gap-2 rounded border border-diff/40 px-2 py-1.5 text-left",
        "bg-diff/10",
        inA ? "hover:bg-diff/20" : "cursor-default opacity-70",
      )}
    >
      <span className="font-mono text-[11px] text-diff">хвост</span>
      <span className="font-mono text-[11px]">{text}</span>
      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
        {formatBytes(tail.length)}
        {inA ? "" : " · в сообщении B"}
      </span>
    </button>
  );
}

/**
 * Панель сравнения: заменяет интерпретацию, пока сравнение активно.
 * Дамп второго сообщения не показывается — только отличия списком.
 */
export function ComparePanel() {
  const messages = useAppStore((state) => state.messages);
  const activeMessageId = useAppStore((state) => state.activeMessageId);
  const compareMessageId = useAppStore((state) => state.compareMessageId);
  const compareBytes = useAppStore((state) => state.compareBytes);
  const compareLoading = useAppStore((state) => state.compareBytesLoading);
  const compareBytesError = useAppStore((state) => state.compareBytesError);
  const bytesA = useAppStore((state) => state.bytes);
  const selection = useAppStore((state) => state.selection);
  const setSelection = useAppStore((state) => state.setSelection);
  const stopCompare = useAppStore((state) => state.stopCompare);
  const startCompare = useAppStore((state) => state.startCompare);

  const messageA = messages.find((item) => item.id === activeMessageId) ?? null;
  const messageB =
    messages.find((item) => item.id === compareMessageId) ?? null;

  const diff = useMemo(() => {
    if (!bytesA || !compareBytes) return null;
    return computeDiff(bytesA, compareBytes);
  }, [bytesA, compareBytes]);

  const rows = diff?.diffBytes.length ?? 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (!messageA || !messageB) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <header className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs">
          {caption(messageA)} ↔ {caption(messageB)}
        </span>
      </header>

      {compareLoading ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : compareBytesError ? (
        <div className="flex flex-col gap-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5">
          <p className="text-[11px] text-destructive">{compareBytesError}</p>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => void startCompare(messageB.id)}
          >
            Повторить
          </Button>
        </div>
      ) : !diff ? (
        <p className="text-xs text-muted-foreground">
          Не удалось получить байты для сравнения
        </p>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
            <Stat
              name="Длины"
              value={`${diff.stats.lengthA} и ${diff.stats.lengthB}`}
            />
            <Stat name="Отличий" value={String(diff.stats.diffCount)} />
            <Stat
              name="Первое"
              value={
                diff.stats.firstDiffOffset === null
                  ? "—"
                  : `+${diff.stats.firstDiffOffset}`
              }
            />
            {diff.tail ? (
              <Stat name="Хвост" value={formatBytes(diff.tail.length)} />
            ) : null}
          </div>

          {diff.stats.diffCount === 0 && !diff.tail ? (
            <p className="text-xs text-muted-foreground">Отличий нет</p>
          ) : (
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-auto rounded border border-border/60"
            >
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((row) => {
                  const item = diff.diffBytes[row.index];
                  const active =
                    selection?.offset === item.offset &&
                    selection.length === 1;

                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() =>
                        setSelection({ offset: item.offset, length: 1 })
                      }
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: row.size,
                        transform: `translateY(${row.start}px)`,
                      }}
                      className={cn(
                        "flex items-center gap-2 border-b border-border/40 px-2 text-left font-mono text-[11px]",
                        "transition-colors hover:bg-muted",
                        active && "bg-primary/15",
                      )}
                    >
                      <span className="w-10 shrink-0 text-muted-foreground">
                        +{item.offset}
                      </span>
                      <span>{hex(item.byteA)}</span>
                      <span className="text-muted-foreground">({item.byteA})</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{hex(item.byteB)}</span>
                      <span className="text-muted-foreground">({item.byteB})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {diff.tail ? (
            <TailCard
              tail={diff.tail}
              onSelect={() =>
                setSelection({
                  offset: diff.tail!.offsetStart,
                  length: diff.tail!.length,
                })
              }
            />
          ) : null}
        </>
      )}

      <Button
        size="sm"
        variant="outline"
        className="shrink-0 self-start"
        onClick={stopCompare}
      >
        Закрыть сравнение
      </Button>
    </div>
  );
}
