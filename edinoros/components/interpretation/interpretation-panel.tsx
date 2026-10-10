"use client";

import { cn } from "@/lib/utils";
import { EmptyHint } from "@/components/empty-hint";
import { ReferenceChip } from "@/components/reference-chip";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { describeRange, formatOffset } from "@/src/lib/hex";
import {
  OBSERVATION_STATUS_LABEL,
  resolveObservationStatus,
} from "@/src/lib/observations";
import type {
  InterpretationStatus,
  Message,
  Observation,
  ObservationKind,
  ObservationStatus,
} from "@/src/types/domain";

const INTERPRETATION_LABEL: Record<InterpretationStatus, string> = {
  parsed: "разобрано",
  partial: "частично",
  "not-parsed": "не разобрано",
};

const INTERPRETATION_TONE: Record<InterpretationStatus, string> = {
  parsed: "text-ok",
  partial: "text-warn",
  "not-parsed": "text-destructive",
};

const OBSERVATION_LABEL: Record<ObservationKind, string> = {
  comment: "комментарий",
  range: "диапазон",
  hypothesis: "гипотеза",
  field: "поле",
};

const STATUS_TONE: Record<ObservationStatus, string> = {
  draft: "text-muted-foreground",
  confirmed: "text-ok",
  refuted: "text-destructive",
  stale: "text-muted-foreground",
};

/**
 * Панель интерпретации: поля сообщения и наблюдения (§6).
 * Место под редактор правил и дифф зарезервировано, но не реализуется.
 */
export function InterpretationPanel({
  message,
  observations,
  loading,
  onSelectRange,
  onHoverField,
  hoveredFieldId,
}: {
  message: Message | null;
  observations: Observation[];
  loading: boolean;
  onSelectRange: (offset: number, length: number) => void;
  onHoverField: (fieldId: string | null) => void;
  hoveredFieldId: string | null;
}) {
  if (!message) {
    return <EmptyHint>Выберите сообщение, чтобы увидеть его поля</EmptyHint>;
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 pr-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              INTERPRETATION_TONE[message.interpretation],
            )}
          >
            {INTERPRETATION_LABEL[message.interpretation]}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {message.verified ? "проверено" : "не проверено"}
          </Badge>
        </div>

        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Поля
          </h3>

          {message.fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Модель не выделила поля в этом сообщении
            </p>
          ) : (
            <ul className="flex flex-col">
              {message.fields.map((field) => (
                <li
                  key={field.id}
                  onMouseEnter={() => onHoverField(field.id)}
                  onMouseLeave={() => onHoverField(null)}
                  className={cn(
                    "flex flex-col gap-0.5 rounded px-1.5 py-1 transition-colors",
                    hoveredFieldId === field.id && "bg-muted",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{field.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {field.type}
                    </span>
                    <span className="ml-auto font-mono text-xs">
                      {field.value}
                    </span>
                    <ReferenceChip
                      kind="bytes"
                      label={formatOffset(field.range.offset).slice(-2)}
                      preview={`${describeRange(field.range)} · пакет #${message.packetNumber}`}
                      onSelect={() =>
                        onSelectRange(field.range.offset, field.range.length)
                      }
                    />
                  </div>
                  {field.note ? (
                    <span className="text-[10px] text-muted-foreground">
                      {field.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Наблюдения
          </h3>

          {loading ? (
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : observations.length === 0 ? (
            <p className="text-xs text-muted-foreground">Нет наблюдений</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {observations.map((observation) => {
                const range = observation.range;
                const status = resolveObservationStatus(observation);

                return (
                  <li
                    key={observation.id}
                    className="flex flex-col gap-1 rounded border border-border/60 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {OBSERVATION_LABEL[observation.kind]}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", STATUS_TONE[status])}
                      >
                        {OBSERVATION_STATUS_LABEL[status]}
                      </Badge>
                      {range ? (
                        <ReferenceChip
                          kind="observation"
                          label="к байтам"
                          preview={describeRange(range)}
                          onSelect={() =>
                            onSelectRange(range.offset, range.length)
                          }
                          className="ml-auto"
                        />
                      ) : null}
                    </div>

                    {observation.kind === "field" && observation.name ? (
                      <p className="font-mono text-xs">
                        {observation.name}
                        {observation.type ? (
                          <span className="text-muted-foreground">
                            {" · "}
                            {observation.type}
                          </span>
                        ) : null}
                      </p>
                    ) : null}

                    {observation.text ? (
                      <p className="text-xs leading-snug">
                        {observation.text}
                      </p>
                    ) : observation.kind === "field" ? null : (
                      <p className="text-xs leading-snug text-muted-foreground italic">
                        без комментария
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="rounded border border-dashed border-border px-2 py-1.5 text-[10px] text-muted-foreground">
          Здесь появятся редактор правил и дифф — место зарезервировано
        </p>
      </div>
    </ScrollArea>
  );
}
