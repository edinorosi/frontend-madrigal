"use client";

import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  CircleDashed,
  CircleHelp,
  FileSearch,
  ListChecks,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/src/lib/keyboard";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { captureTitle } from "@/src/lib/format";
import {
  MODEL_STATUS_LABEL,
  MODEL_STATUS_TONE,
} from "@/src/lib/model-status";
import { useAppStore } from "@/src/store/app";
import type { CheckFilter } from "@/src/store/app";
import type { CheckResult, CheckRow, CheckStatus } from "@/src/types/domain";

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
      role="img"
      title={title}
      aria-label={title}
      className={cn("inline-flex shrink-0", tone)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  );
}

/** Сводка: «✓ 9 · ◌ 1 · ? 1 · ✗ 1». Клик по значку — фильтр по статусу. */
function SummaryChips({
  result,
  activeStatus,
  onSelect,
}: {
  result: CheckResult;
  activeStatus: CheckFilter["status"];
  onSelect: (status: CheckFilter["status"]) => void;
}) {
  const { summary } = result;

  const chips: {
    key: CheckStatus;
    Icon: typeof Check;
    tone: string;
    title: string;
    count: number;
  }[] = [
    {
      key: "ok",
      Icon: Check,
      tone: "text-ok",
      title: "Значение совпало с ожидаемым",
      count: summary.ok,
    },
    {
      key: "partial",
      Icon: CircleDashed,
      tone: "text-warn",
      title: "Значение не извлечено, но кадр разобран",
      count: summary.partial,
    },
    {
      key: "unknown",
      Icon: CircleHelp,
      tone: "text-muted-foreground",
      title: "Не удалось проверить",
      count: summary.unknown,
    },
    {
      key: "error",
      Icon: X,
      tone: "text-destructive",
      title: "Значение не совпало с ожидаемым",
      count: summary.error,
    },
  ];

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      {chips.map(({ key, Icon, tone, title, count }) => {
        const active = activeStatus === key;
        return (
          <button
            key={key}
            type="button"
            title={`${title} (фильтр)`}
            aria-pressed={active}
            aria-label={`${title}: ${count}`}
            onClick={() => onSelect(active ? "all" : key)}
            className={cn(
              "flex h-7 items-center gap-0.5 rounded px-1.5 outline-none",
              "focus-visible:ring-1 focus-visible:ring-ring",
              active && "bg-muted ring-1 ring-ring",
              tone,
            )}
          >
            <Icon className="size-3" aria-hidden="true" />
            {count}
          </button>
        );
      })}
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
  error,
  onRetry,
}: {
  coverage: { covered: number[]; seen: number[] } | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <span className="shrink-0 text-[11px] text-muted-foreground">
        Опкоды: …
      </span>
    );
  }
  // Сбой сборки покрытия не должен выглядеть как «покрытия нет».
  if (error) {
    return (
      <span
        className="shrink-0 text-[11px] text-destructive"
        title={error}
      >
        Опкоды: ошибка
        <button
          type="button"
          className="ml-1 rounded px-0.5 underline underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onRetry}
        >
          Повторить
        </button>
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
          className="h-7 gap-1 px-2 text-[11px]"
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
  const cancelCheck = useAppStore((state) => state.cancelCheck);
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
  const checkFilter = useAppStore((state) => state.checkFilter);
  const setCheckFilter = useAppStore((state) => state.setCheckFilter);
  const overlayOpen = useAppStore((state) => state.overlayOpen);

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

  // Esc закрывает панель, если каскадом не занят HEX (его Esc-порядок выше).
  useEffect(() => {
    if (escapeDelegated) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc из поля ввода завершает ввод, а не закрывает панель.
      if (isTypingTarget(event.target)) return;
      // Открытое меню (записи, статус) забирает Esc себе.
      if (overlayOpen) return;
      closeCheck();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [escapeDelegated, closeCheck, overlayOpen]);

  const rows = result?.rows ?? [];
  // Фильтры живут в сторе: панель сворачивается — фильтры не теряются.
  const { query: filterQuery, status: filterStatus } = checkFilter;
  const filteredRows = useMemo(() => {
    const needle = filterQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (filterStatus !== "all" && row.status !== filterStatus) return false;
      if (needle) {
        const haystack =
          `${row.action} ${row.time} ${row.expected ?? ""} ${row.extracted}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  },     [rows, filterQuery, filterStatus]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <section className="flex shrink-0 flex-col border-t bg-background">
      <header className="flex shrink-0 flex-col gap-y-2 px-2 py-2">
        {/* Строка 1 — контекст проверки и действия. */}
        <div className="flex items-center justify-between gap-x-2">
          <div className="flex min-w-0 items-center gap-x-2">
            <h2 className="shrink-0 text-sm font-medium leading-7">Проверка</h2>
            {/* Записи проверки (R4.2): мультивыбор, по умолчанию все. */}
            <CaptureSelect />
            {/* Модель (R3-г): имя и статус; обновляется при смене модели. */}
            <span className="flex min-w-0 items-center gap-1 text-[11px] leading-7 text-muted-foreground">
              Модель:{" "}
              {activeModel ? (
                <>
                  <span className="truncate font-mono">{activeModel.name}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 px-1 text-[10px] font-normal",
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
            <CoverageBadge
              coverage={coverage}
              loading={coverageLoading}
              error={coverageError}
              onRetry={() => void loadCheckCoverage()}
            />
          </div>
          {(result || error) && !loading ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1 px-2 text-[11px]"
              onClick={() => void runCheck()}
            >
              <RefreshCw className="size-3" />
              Перепроверить
            </Button>
          ) : null}
          {loading ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 gap-1 px-2 text-[11px]"
              onClick={cancelCheck}
            >
              Отменить
            </Button>
          ) : null}
        </div>

        {/* Строка 2 — фильтры и счётчик. Сброс — клик по активному чипу. */}
        {result ? (
          <div className="flex items-center justify-between gap-x-2">
            <div className="flex min-w-0 flex-1 items-center gap-x-2">
              <Input
                value={filterQuery}
                onChange={(event) => setCheckFilter({ query: event.target.value })}
                placeholder="Поиск: действие, время, значения"
                aria-label="Поиск по таблице проверок"
                className="h-7 min-w-0 max-w-64 flex-1 text-[11px]"
              />
              <SummaryChips
                result={result}
                activeStatus={filterStatus}
                onSelect={(status) => setCheckFilter({ status })}
              />
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Показано{" "}
              <span className="font-mono">{filteredRows.length}</span> из{" "}
              <span className="font-mono">{rows.length}</span>
            </span>
          </div>
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
            Нет строк по фильтру
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
