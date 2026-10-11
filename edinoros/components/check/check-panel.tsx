"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  CircleDashed,
  CircleHelp,
  FileSearch,
  Filter,
  ListChecks,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { captureTitle } from "@/src/lib/format";
import {
  MODEL_STATUS_LABEL,
  MODEL_STATUS_TONE,
} from "@/src/lib/model-status";
import { useAppStore } from "@/src/store/app";
import type { CheckResult, CheckRow } from "@/src/types/domain";

const ROW_HEIGHT = 34;

const STATUS = {
  ok: {
    Icon: Check,
    tone: "text-ok",
    title: "Значение совпало с ожидаемым",
  },
  partial: {
    Icon: CircleDashed,
    tone: "text-warn",
    title: "Значение не извлечено, но кадр разобран",
  },
  unknown: {
    Icon: CircleHelp,
    tone: "text-muted-foreground",
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
  if (row.status === "partial") {
    return "Значение не извлечено, но кадр разобран";
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

/** Сводка: «✓ 9 · ◌ 1 · ? 1 · ✗ 1». */
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
        title="Значение не извлечено, но кадр разобран"
      >
        <CircleDashed className="size-3" />
        {summary.partial}
      </span>
      <span
        className="flex items-center gap-0.5 text-muted-foreground"
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

function formatOpcodes(opcodes: number[]): string {
  return opcodes
    .map((opcode) => `0x${opcode.toString(16).toUpperCase().padStart(2, "0")}`)
    .join(", ");
}

/**
 * Покрытие опкодов (R4.2): сколько встреченных в записях опкодов
 * заявлено в правилах модели. Тултип раскрывает списки.
 */
function CoverageBadge({
  coverage,
  loading,
}: {
  coverage: { covered: number[]; seen: number[] } | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="shrink-0 text-[11px] text-muted-foreground">
        Опкоды: …
      </span>
    );
  }
  if (!coverage || coverage.seen.length === 0) return null;

  const coveredSet = new Set(coverage.covered);
  const seenCovered = coverage.seen.filter((opcode) => coveredSet.has(opcode));
  const seenUncovered = coverage.seen.filter(
    (opcode) => !coveredSet.has(opcode),
  );
  const coveredUnseen = coverage.covered.filter(
    (opcode) => !coverage.seen.includes(opcode),
  );

  const title = [
    `Покрыто: ${formatOpcodes(seenCovered)}`,
    seenUncovered.length > 0
      ? `Не покрыто: ${formatOpcodes(seenUncovered)}`
      : null,
    coveredUnseen.length > 0
      ? `Есть в правилах, но не встречено: ${formatOpcodes(coveredUnseen)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      className={cn(
        "shrink-0 text-[11px] text-muted-foreground",
        seenUncovered.length > 0 && "text-warn",
      )}
      title={title}
    >
      Опкоды: {seenCovered.length} из {coverage.seen.length}
    </span>
  );
}

/**
 * Селектор записей проверки (R4.2): чекбоксы в выпадающем меню.
 * По умолчанию выбраны все записи.
 */
function CaptureSelect() {
  const captures = useAppStore((state) => state.captures);
  const checkCaptureIds = useAppStore((state) => state.checkCaptureIds);
  const setCheckCaptureIds = useAppStore(
    (state) => state.setCheckCaptureIds,
  );
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const selectedIds = useMemo(
    () =>
      (checkCaptureIds ?? captures.map((item) => item.id)).filter((id) =>
        captures.some((item) => item.id === id),
      ),
    [checkCaptureIds, captures],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const allSelected = selectedIds.length === captures.length;
  const label =
    selectedIds.length === 1 && captures.length > 1
      ? "Запись: 1"
      : `Записи: ${selectedIds.length} из ${captures.length}`;

  const toggle = (captureId: string, checked: boolean) => {
    if (checked) {
      const next = [...selectedIds, captureId];
      setCheckCaptureIds(
        next.length === captures.length ? null : next,
      );
      return;
    }
    // Последнюю запись снять нельзя — проверять нечего.
    if (selectedIds.length <= 1) return;
    const next = selectedIds.filter((id) => id !== captureId);
    setCheckCaptureIds(next.length === captures.length ? null : next);
  };

  return (
    <DropdownMenu onOpenChange={setOverlayOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-2 text-[11px]"
        >
          <ListChecks className="size-3" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {captures.map((capture) => (
          <DropdownMenuCheckboxItem
            key={capture.id}
            checked={selectedSet.has(capture.id)}
            onCheckedChange={(checked) =>
              toggle(capture.id, checked === true)
            }
            onSelect={(event) => event.preventDefault()}
          >
            <span className="truncate font-mono text-xs">
              {captureTitle(capture)}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={allSelected}
          onSelect={() => setCheckCaptureIds(null)}
        >
          Выбрать все
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  const result = useAppStore((state) => state.checkResult);
  const loading = useAppStore((state) => state.checkLoading);
  const error = useAppStore((state) => state.checkError);
  const warnings = useAppStore((state) => state.checkWarnings);
  const coverage = useAppStore((state) => state.checkCoverage);
  const coverageLoading = useAppStore(
    (state) => state.checkCoverageLoading,
  );
  const coverageError = useAppStore(
    (state) => state.checkCoverageError,
  );
  const loadCheckCoverage = useAppStore(
    (state) => state.loadCheckCoverage,
  );
  const closeCheck = useAppStore((state) => state.closeCheck);
  const runCheck = useAppStore((state) => state.runCheck);
  const gotoMessage = useAppStore((state) => state.gotoMessage);
  const models = useAppStore((state) => state.models);
  const activeModelId = useAppStore((state) => state.activeModelId);
  const checkCaptureIds = useAppStore((state) => state.checkCaptureIds);
  const capturesLength = useAppStore((state) => state.captures.length);

  const activeModel = models?.find((item) => item.id === activeModelId) ?? null;

  // Покрытие собирается при открытии (openCheck); при смене модели или
  // выбора записей стор сбрасывает его — добираем здесь. Ошибка не
  // повторяется автоматически (иначе петля); «Перепроверить» перезапустит.
  useEffect(() => {
    if (coverage === null && !coverageLoading && coverageError === null) {
      void loadCheckCoverage();
    }
    // Зависимости намеренно по значениям, а не по ссылке экшена.
  }, [coverage, coverageLoading, coverageError, checkCaptureIds, activeModelId, capturesLength, loadCheckCoverage]);

  // Фильтр «Расхождения» (R4.1): только строки со статусом error.
  const [onlyErrors, setOnlyErrors] = useState(false);

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
  const filteredRows = onlyErrors
    ? rows.filter((row) => row.status === "error")
    : rows;
  const errorCount = result?.summary.error ?? 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <section className="flex shrink-0 flex-col border-t bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2">
        <h2 className="shrink-0 text-sm font-medium">Проверка</h2>
        {/* Записи проверки (R4.2): мультивыбор, по умолчанию все. */}
        <CaptureSelect />
        {/* Модель (R3-г): имя и статус; обновляется при смене активной модели. */}
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          Модель:{" "}
          {activeModel ? (
            <>
              <span className="font-mono">{activeModel.name}</span>
              <Badge
                variant="outline"
                className={cn(
                  "px-1 text-[10px] font-normal",
                  MODEL_STATUS_TONE[activeModel.status],
                )}
              >
                {MODEL_STATUS_LABEL[activeModel.status]}
              </Badge>
            </>
          ) : (
            <span className="font-mono">—</span>
          )}
        </span>
        {/* Покрытие опкодов (R4.2). */}
        <CoverageBadge coverage={coverage} loading={coverageLoading} />
        {result ? (
          <>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Всего: <span className="font-mono">{result.summary.total}</span>
            </span>
            <SummaryChips result={result} />
            {rows.length > 0 ? (
              <Button
                size="sm"
                variant={onlyErrors ? "secondary" : "ghost"}
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => setOnlyErrors((value) => !value)}
              >
                <Filter className="size-3" />
                Расхождения: {errorCount}
              </Button>
            ) : null}
          </>
        ) : null}
        {(result || error) && !loading ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-6 gap-1 px-2 text-[11px]"
            onClick={() => void runCheck()}
          >
            <RefreshCw className="size-3" />
            Перепроверить
          </Button>
        ) : null}
      </header>

      {/* Агрегация (R4.2): сбой одной записи — предупреждение, не пустой итог. */}
      {warnings && warnings.length > 0 ? (
        <div className="shrink-0 border-t bg-warn/5 px-2 py-1">
          {warnings.map((warning) => (
            <p key={warning} className="text-[11px] text-warn">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

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
        ) : filteredRows.length === 0 ? (
          <p className="pt-2 text-[11px] text-muted-foreground">
            Расхождений нет
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
                  const item = filteredRows[row.index];
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
