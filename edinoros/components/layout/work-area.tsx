"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
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
import { resolveMessageModel } from "@/src/lib/message-model";
import { applyModelCached } from "@/src/lib/parse";
import { useAppStore } from "@/src/store/app";
import type { Direction, ParseStatus } from "@/src/types/domain";

const DIRECTION_LABEL: Record<Direction, string> = {
  request: "запрос",
  response: "ответ",
};

const STATUS_LABEL: Record<ParseStatus, string> = {
  parsed: "разобрано",
  partial: "частично",
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
  const bytesError = useAppStore((state) => state.bytesError);
  const selectMessage = useAppStore((state) => state.selectMessage);
  const activeMessageId = useAppStore((state) => state.activeMessageId);
  const loadingBytes = useAppStore((state) => state.loading.bytes);
  const observations = useAppStore((state) => state.observations);
  const loadingObservations = useAppStore(
    (state) => state.loading.observations,
  );

  const appError = useAppStore((state) => state.error);
  const loadProject = useAppStore((state) => state.loadProject);
  /**
   * Текст скрытой ошибки, а не булев флаг: при повторной загрузке ошибка
   * та же — баннер не показываем, при новой (другой текст) — показываем.
   */
  const [hiddenError, setHiddenError] = useState<string | null>(null);

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

  // Успех импорта — не состояние на все времена: показываем полосу ~3 с,
  // после чего сбрасываем фиазу, чтобы баннер не возвращался при
  // переустановке рабочей зоны (например, выход из редактора модели).
  const [importDoneNotice, setImportDoneNotice] = useState(false);
  useEffect(() => {
    if (importPhase !== "done") return;
    setImportDoneNotice(true);
    const timer = window.setTimeout(() => {
      setImportDoneNotice(false);
      dismissImportError();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [importPhase, dismissImportError]);

  const fieldsSource = useAppStore((state) => state.fieldsSource);
  const models = useAppStore((state) => state.models);
  const activeModelId = useAppStore((state) => state.activeModelId);
  /**
   * Модель сообщения (R10.1): своя привязка или активная модель проекта.
   * Подсветка HEX и непокрытые байты считаются именно ей.
   */
  const messageModel = useMemo(
    () => resolveMessageModel(message, models, activeModelId),
    [message, models, activeModelId],
  );

  /**
   * Подсветка поля в HEX: при fieldsSource=model поля считаются на лету
   * (кэш applyModelCached), искать их в message.fields бессмысленно.
   */
  const hoveredField = useMemo(() => {
    if (!message) return null;

    if (fieldsSource === "model") {
      if (!bytes || !messageModel) return null;
      const apply = applyModelCached(message.id, bytes, messageModel);
      return apply.fields.find((field) => field.id === hoveredFieldId) ?? null;
    }

    return message.fields.find((field) => field.id === hoveredFieldId) ?? null;
  }, [message, fieldsSource, bytes, messageModel, hoveredFieldId]);

  /**
   * Непокрытые моделью байты (R9.1): серый слой в HEX при fieldsSource=model.
   * В JSON-режиме и при сравнении слой не показывается.
   */
  const uncoveredRanges = useMemo(() => {
    if (compareActive || fieldsSource !== "model" || !message || !bytes || !messageModel) {
      return null;
    }
    const apply = applyModelCached(message.id, bytes, messageModel);
    return apply.uncovered.length > 0 ? apply.uncovered : null;
  }, [compareActive, fieldsSource, message, bytes, messageModel]);

  // Сбрасываем скрытие при каждой новой попытке загрузки проекта (rising
  // edge loading.captures): после [Скрыть] и повторного открытия проекта
  // ошибка та же, но баннер должен появиться снова. Локальный флаг живёт
  // только в рамках одного attempt.
  const prevLoadingCaptures = useRef(loadingCaptures);
  useEffect(() => {
    if (loadingCaptures && !prevLoadingCaptures.current) {
      setHiddenError(null);
    }
    prevLoadingCaptures.current = loadingCaptures;
  }, [loadingCaptures]);

  // Новая ошибка (другой текст, другой метод, другой тип) — показываем
  // баннер, даже если предыдущая была скрыта.
  useEffect(() => {
    setHiddenError(null);
  }, [appError]);

  /**
   * Читаемое сообщение из текста ошибки. HttpServiceError уже несёт
   * понятный текст (routeMissing / HTTP-статус / сеть / таймаут) —
   * здесь только смягчаем формулировку для пользователя.
   */
  const appErrorText = useMemo(() => {
    if (!appError) return null;
    if (appError.includes("не реализован на бэке")) {
      return appError.replace(
        "не реализован на бэке",
        "ещё не реализован на бэке — данные недоступны",
      );
    }
    if (appError.includes("Нет связи с бэкендом")) {
      return `${appError}. Проверьте, что бэкенд запущен.`;
    }
    return appError;
  }, [appError]);

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

      {importDoneNotice && !importError ? (
        <div className="flex shrink-0 items-center gap-3 border-b bg-ok/10 px-4 py-2">
          <span className="text-xs text-ok">Запись загружена</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setImportDoneNotice(false)}
          >
            Скрыть
          </Button>
        </div>
      ) : null}

      {appErrorText && hiddenError !== appErrorText ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-destructive/40 bg-destructive/5 px-4 py-2">
          <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 text-xs text-destructive">
            {appErrorText}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadProject()}
          >
            Повторить
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setHiddenError(appErrorText)}
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
                ) : bytesError && !bytes ? (
                  <div className="flex flex-col items-start gap-2 pt-1">
                    <p className="text-xs text-destructive">{bytesError}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={activeMessageId === null}
                      onClick={() => {
                        if (activeMessageId) void selectMessage(activeMessageId);
                      }}
                    >
                      <RefreshCw className="size-3.5" />
                      Повторить
                    </Button>
                  </div>
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
                    uncoveredRanges={uncoveredRanges}
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
