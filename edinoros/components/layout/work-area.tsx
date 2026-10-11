"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CheckPanel } from "@/components/check/check-panel";
import { EmptyHint } from "@/components/empty-hint";
import { ComparePanel } from "@/components/interpretation/compare-panel";
import { ComparePicker } from "@/components/interpretation/compare-picker";
import { HexDump } from "@/components/hex/hex-dump";
import { HexMinimap } from "@/components/hex/hex-minimap";
import { ImportButton } from "@/components/import-button";
import { InterpretationPanel } from "@/components/interpretation/interpretation-panel";
import { ReferenceChip } from "@/components/reference-chip";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { computeDiff, maskToRanges } from "@/src/lib/diff";
import { formatBytes, formatClock, formatTuple } from "@/src/lib/format";
import { useAppStore } from "@/src/store/app";
import type { Direction, ParseStatus } from "@/src/types/domain";

const DIRECTION_LABEL: Record<Direction, string> = {
  request: "запрос",
  response: "ответ",
};

const STATUS_LABEL: Record<ParseStatus, string> = {
  parsed: "разобрано",
  unknown: "неизвестно",
  error: "ошибка разбора",
};

/**
 * Рабочая зона: HEX-дамп и интерпретация — одно полотно.
 * Колонки разведены воздухом, разделительной линии между ними нет (§4, §6).
 */
export function WorkArea() {
  const loadingCaptures = useAppStore((state) => state.loading.captures);
  const hasCaptures = useAppStore((state) => state.captures.length > 0);

  const session = useAppStore(
    (state) =>
      state.sessions.find((item) => item.id === state.activeSessionId) ?? null,
  );
  const message = useAppStore(
    (state) =>
      state.messages.find((item) => item.id === state.activeMessageId) ?? null,
  );

  const bytes = useAppStore((state) => state.bytes);
  const loadingBytes = useAppStore((state) => state.loading.bytes);
  const observations = useAppStore((state) => state.observations);
  const loadingObservations = useAppStore(
    (state) => state.loading.observations,
  );

  const selection = useAppStore((state) => state.selection);
  const hoveredFieldId = useAppStore((state) => state.hoveredFieldId);
  const setSelection = useAppStore((state) => state.setSelection);
  const setHoveredField = useAppStore((state) => state.setHoveredField);
  const saveObservation = useAppStore((state) => state.saveObservation);
  const removeObservation = useAppStore((state) => state.removeObservation);

  const compareMessageId = useAppStore((state) => state.compareMessageId);
  const compareBytes = useAppStore((state) => state.compareBytes);
  const overlayOpen = useAppStore((state) => state.overlayOpen);
  const stopCompare = useAppStore((state) => state.stopCompare);
  const pulseSource = useAppStore((state) => state.pulseSource);

  const checkOpen = useAppStore((state) => state.checkOpen);
  const openCheck = useAppStore((state) => state.openCheck);
  const closeCheck = useAppStore((state) => state.closeCheck);
  const journalCount = useAppStore((state) => state.journalCount);

  const compareActive = compareMessageId !== null;

  /** Журнал действий есть — кнопка «Проверка» имеет смысл. */
  const checkAvailable = journalCount !== null && journalCount > 0;

  /** HEX-дамп смонтирован — Esc обрабатывает он, каскадом закрывая «Проверку». */
  const hexMounted = Boolean(message && bytes && !loadingBytes);

  /**
   * Маска отличий по байтам A — именно маска, а не список диапазонов:
   * в HEX проверка идёт на каждый отрисованный байт, и поиск по массиву
   * диапазонов дал бы квадратичную сложность на длинных сообщениях.
   */
  const diffMask = useMemo(() => {
    if (!compareActive || !bytes || !compareBytes) return null;

    const diff = computeDiff(bytes, compareBytes);
    const mask = new Uint8Array(bytes.length);

    for (const item of diff.diffBytes) {
      if (item.offset < mask.length) mask[item.offset] = 1;
    }

    // Хвост A — тоже отличие.
    if (diff.tail?.longer === "A") {
      mask.fill(1, diff.tail.offsetStart);
    }

    return mask;
  }, [compareActive, bytes, compareBytes]);

  const diffRanges = useMemo(
    () => (diffMask ? maskToRanges(diffMask) : undefined),
    [diffMask],
  );

  const hexScrollRef = useRef<HTMLDivElement>(null);

  // Заглушка «показать в пакете»: подсвечиваем ссылку в шапке по тику из стора
  // (источник — ПКМ sidebar или меню HEX).
  const sourcePulseTick = useAppStore((state) => state.sourcePulseTick);
  const [sourcePulse, setSourcePulse] = useState(false);
  const pulseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (sourcePulseTick === 0) return;

    setSourcePulse(true);
    if (pulseTimerRef.current !== null) {
      window.clearTimeout(pulseTimerRef.current);
    }
    pulseTimerRef.current = window.setTimeout(
      () => setSourcePulse(false),
      1200,
    );
  }, [sourcePulseTick]);

  useEffect(
    () => () => {
      if (pulseTimerRef.current !== null) {
        window.clearTimeout(pulseTimerRef.current);
      }
    },
    [],
  );

  const importPhase = useAppStore((state) => state.importPhase);
  const importProgress = useAppStore((state) => state.importProgress);
  const importError = useAppStore((state) => state.importError);
  const cancelImport = useAppStore((state) => state.cancelImport);
  const dismissImportError = useAppStore((state) => state.dismissImportError);

  const hoveredField =
    message?.fields.find((field) => field.id === hoveredFieldId) ?? null;

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      {importPhase === "running" ? (
        <div className="flex shrink-0 items-center gap-3 border-b bg-muted/40 px-4 py-2">
          <span className="shrink-0 text-xs">Загрузка записи…</span>
          <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-border">
            {importProgress > 0 ? (
              <div
                className="h-full bg-primary transition-[width] duration-100"
                style={{ width: `${importProgress * 100}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={cancelImport}>
            Отменить
          </Button>
        </div>
      ) : null}

      {importError ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-destructive/40 bg-destructive/5 px-4 py-2">
          <span className="text-xs text-destructive">{importError}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={dismissImportError}
          >
            Скрыть
          </Button>
        </div>
      ) : null}

      {loadingCaptures ? (
        <div className="flex min-h-0 flex-1 gap-6 p-4">
          <Skeleton className="h-full basis-3/5" />
          <Skeleton className="h-full basis-2/5" />
        </div>
      ) : !hasCaptures ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">
            Проект пуст — загрузите запись PCAP, чтобы начать
          </p>
          <ImportButton size="sm" variant="outline" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-6 p-4">
          <section className="flex min-w-0 basis-3/5 flex-col gap-2">
            <header className="flex shrink-0 items-center gap-2">
              <h1 className="truncate font-mono text-xs">
                {session ? formatTuple(session.tuple) : "Сессия не выбрана"}
              </h1>
              {message ? (
                <ReferenceChip
                  kind="packet"
                  label={`#${message.packetNumber}`}
                  preview={`Пакет #${message.packetNumber} в записи`}
                  onSelect={() =>
                    setSelection({ offset: 0, length: message.length })
                  }
                  className={cn(
                    sourcePulse && "ring-2 ring-primary ring-offset-1",
                  )}
                />
              ) : null}
            </header>

            {message ? (
              <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <StatusIcon status={message.status} />
                <span>{STATUS_LABEL[message.status]}</span>
                <span className="text-border">·</span>
                <span>{DIRECTION_LABEL[message.direction]}</span>
                <span className="text-border">·</span>
                <span className="font-mono">{formatBytes(message.length)}</span>
                <span className="text-border">·</span>
                <span className="font-mono">
                  {formatClock(message.timestamp)}
                </span>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 gap-2">
              <div className="min-w-0 flex-1">
                {!session ? (
                  <EmptyHint>Выберите сессию в списке слева</EmptyHint>
                ) : !message ? (
                  <EmptyHint>
                    Сообщение не выбрано — выберите его в списке слева
                  </EmptyHint>
                ) : loadingBytes || !bytes ? (
                  <div className="flex flex-col gap-1 pt-1">
                    {Array.from({ length: 12 }, (_, index) => (
                      <Skeleton key={index} className="h-4 w-full" />
                    ))}
                  </div>
                ) : (
                  <HexDump
                    key={message.id}
                    bytes={bytes}
                    selection={selection}
                    highlight={compareActive ? null : (hoveredField?.range ?? null)}
                    diffMask={diffMask}
                    onSelect={setSelection}
                    messageId={message.id}
                    onCreateObservation={saveObservation}
                    onShowSource={pulseSource}
                    overlayOpen={overlayOpen}
                    checkActive={checkOpen}
                    onStopCheck={closeCheck}
                    compareActive={compareActive}
                    onStopCompare={stopCompare}
                    scrollRef={hexScrollRef}
                  />
                )}
              </div>

              {message && bytes ? (
                <HexMinimap
                  key={message.id}
                  length={message.length}
                  selection={selection}
                  diffRanges={diffRanges}
                  scrollRef={hexScrollRef}
                />
              ) : null}
            </div>

            {checkAvailable ? (
              <div className="flex shrink-0 gap-1.5">
                <Button
                  variant={checkOpen ? "secondary" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    void (checkOpen ? closeCheck() : openCheck());
                  }}
                >
                  Проверка
                </Button>
              </div>
            ) : null}

            {checkOpen ? <CheckPanel escapeDelegated={hexMounted} /> : null}
          </section>

          <section className="flex min-w-0 basis-2/5 flex-col gap-2">
            <header className="flex shrink-0 items-center">
              <h2 className="text-sm font-medium">
                {compareActive ? "Сравнение" : "Интерпретация"}
              </h2>
            </header>
            <div className="min-h-0 flex-1">
              {compareActive ? (
                <ComparePanel />
              ) : (
                <InterpretationPanel
                  message={message}
                  observations={observations}
                  loading={loadingObservations}
                  onSelectRange={(offset, length) =>
                    setSelection({ offset, length })
                  }
                  onHoverField={setHoveredField}
                  hoveredFieldId={hoveredFieldId}
                  onSaveObservation={saveObservation}
                  onRemoveObservation={removeObservation}
                />
              )}
            </div>
            <div className="flex shrink-0 gap-1.5">
              {compareActive ? null : <ComparePicker />}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
