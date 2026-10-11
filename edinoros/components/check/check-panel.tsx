"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CircleHelp, FileSearch, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { captureTitle } from "@/src/lib/format";
import { useAppStore } from "@/src/store/app";
import type { CheckResult, CheckRow, CheckStatus } from "@/src/types/domain";

const ROW_HEIGHT = 34;

const STATUS = {
  ok: {
    Icon: Check,
    tone: "text-ok",
    title: "Значение совпало с ожидаемым",
  },
  unknown: {
    Icon: CircleHelp,
    tone: "text-warn",
    title: "Не удалось проверить",
  },
  error: {
    Icon: X,
    tone: "text-destructive",
    title: "Значение не совпало с ожидаемым",
  },
} as const;

/** Причина «не проверено»: нет сообщения или модель его не разобрала. */
function statusTitle(row: CheckRow): string {
  if (row.status === "unknown") {
    return row.messageId === null
      ? "Не удалось проверить: нет сообщения"
      : "Не удалось проверить: модель не разобрала сообщение";
  }
  return STATUS[row.status].title;
}

function CheckStatusIcon({ row }: { row: CheckRow }) {
  const { Icon, tone } = STATUS[row.status];
  const title = statusTitle(row);

  return (
    <span
      title={title}
      aria-label={title}
      className={cn("inline-flex shrink-0", tone)}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** Сводка: «✓ 9 · ? 2 · ✗ 1». */
function SummaryChips({ result }: { result: CheckResult }) {
  const { summary } = result;

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className="flex items-center gap-0.5 text-ok"
        title="Значение совпало с ожидаемым"
      >
        <Check className="size-3" />
        {summary.ok}
      </span>
      <span
        className="flex items-center gap-0.5 text-warn"
        title="Не удалось проверить"
      >
        <CircleHelp className="size-3" />
        {summary.unknown}
      </span>
      <span
        className="flex items-center gap-0.5 text-destructive"
        title="Значение не совпало с ожидаемым"
      >
        <X className="size-3" />
        {summary.error}
      </span>
    </div>
  );
}

/** «Извлечено» на узкой панели: при расхождении показывает «30 → 0x1E (30)». */
function extractedText(row: CheckRow): string {
  if (row.expected !== null && row.status === "error") {
    return `${row.expected} → ${row.extracted}`;
  }
  return row.extracted;
}

/**
 * Панель «Проверка» (R4): выдвижной блок под HEX-дампом в колонке дампа.
 * Таблица журнала против разбора: «Ожидалось» — что задал оператор,
 * «Извлечено» — что модель прочитала из байт. Клик по строке уводит
 * к байтам сообщения в HEX.
 *
 * Открытие и закрытие — только кнопкой «Проверка» внизу колонки.
 */
export function CheckPanel({ escapeDelegated = false }: { escapeDelegated?: boolean }) {
  const captures = useAppStore((state) => state.captures);
  const activeCaptureId = useAppStore((state) => state.activeCaptureId);
  const result = useAppStore((state) => state.checkResult);
  const loading = useAppStore((state) => state.checkLoading);
  const error = useAppStore((state) => state.checkError);
  const closeCheck = useAppStore((state) => state.closeCheck);
  const runCheck = useAppStore((state) => state.runCheck);
  const gotoMessage = useAppStore((state) => state.gotoMessage);

  const capture = captures.find((item) => item.id === activeCaptureId) ?? null;

  // Esc закрывает панель, если каскадом не занят HEX (его Esc-порядок выше).
  useEffect(() => {
    if (escapeDelegated) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCheck();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [escapeDelegated, closeCheck]);

  const rows = result?.rows ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <section className="flex shrink-0 flex-col border-t bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2">
        <h2 className="shrink-0 text-sm font-medium">Проверка</h2>
        <span className="truncate text-[11px] text-muted-foreground">
          Запись:{" "}
          <span className="font-mono">{captureTitle(capture)}</span>
        </span>
        {/* TODO: идентификатор модели появится с бэком — в данных его пока нет. */}
        <span className="shrink-0 text-[11px] text-muted-foreground">
          Модель: <span className="font-mono">—</span>
        </span>
        {result ? (
          <>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Всего: <span className="font-mono">{result.summary.total}</span>
            </span>
            <SummaryChips result={result} />
          </>
        ) : null}
      </header>

      <div className="h-64 shrink-0 px-2 pb-3">
        {loading && !result ? (
          <div className="flex flex-col gap-1.5 pt-1">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col gap-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5">
            <p className="text-[11px] text-destructive">{error}</p>
            <div>
              <Button size="sm" variant="outline" onClick={() => void runCheck()}>
                Повторить
              </Button>
            </div>
          </div>
        ) : !result ? (
          <div className="flex flex-col items-start gap-2 pt-2">
            <p className="text-[11px] text-muted-foreground">
              Проверка не запущена
            </p>
            <Button size="sm" variant="outline" onClick={() => void runCheck()}>
              Запустить
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="pt-2 text-[11px] text-muted-foreground">
            Нет действий в журнале
          </p>
        ) : (
          <div className="flex h-full flex-col gap-1">
            <div className="flex shrink-0 items-center gap-2 border-b px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="w-12 shrink-0">Время</span>
              <span className="min-w-0 flex-1">Действие</span>
              <span className="w-16 shrink-0 text-right">Ожидалось</span>
              <span className="w-28 shrink-0 text-right">Извлечено</span>
              <span className="sr-only">Статус</span>
              <span className="w-4 shrink-0" />
              <span className="w-5 shrink-0" />
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((row) => {
                  const item = rows[row.index];
                  const navigable = item.messageId !== null;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!navigable}
                      title={navigable ? "К байтам" : "Нет привязки к сообщению"}
                      onClick={() => {
                        if (item.messageId) void gotoMessage(item.messageId);
                      }}
                      className={cn(
                        "absolute left-0 flex w-full items-center gap-2 rounded px-1 text-left",
                        navigable ? "hover:bg-muted/60" : "cursor-default",
                      )}
                      style={{
                        height: ROW_HEIGHT,
                        transform: `translateY(${row.start}px)`,
                      }}
                    >
                      <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">
                        {item.time}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px]">
                        {item.action}
                      </span>
                      <span className="w-16 shrink-0 text-right font-mono text-[11px]">
                        {item.expected === null ? "—" : item.expected}
                      </span>
                      <span className="flex w-28 shrink-0 justify-end">
                        {/* Широкая панель: только извлечённое. */}
                        <span className="hidden truncate font-mono text-[11px] sm:block">
                          {item.extracted}
                        </span>
                        {/* Узкая: при расхождении — «30 → 0x1E (30)». */}
                        <span className="block truncate font-mono text-[11px] sm:hidden">
                          {extractedText(item)}
                        </span>
                      </span>
                      <span className="flex w-4 shrink-0 justify-center">
                        <CheckStatusIcon row={item} />
                      </span>
                      <span
                        className={cn(
                          "flex w-5 shrink-0 justify-center",
                          navigable
                            ? "text-muted-foreground"
                            : "text-border",
                        )}
                      >
                        <FileSearch className="size-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
