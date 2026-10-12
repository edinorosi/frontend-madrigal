"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ReferenceChip } from "@/components/reference-chip";
import { describeRange, formatOffset } from "@/src/lib/hex";
import type { MessageField } from "@/src/types/domain";

/**
 * Отношение поля к предыдущему сообщению (тот же поток, тот же поток
 * данных): «=» без изменений, «Δ» значение изменилось, «+» новое поле,
 * «−» поле исчезло, «—» предыдущего сообщения нет (дельта не считается).
 */
export type FieldMark = "same" | "changed" | "added" | "removed" | "none";

export interface FieldRow {
  field: MessageField;
  mark: FieldMark;
  /** Значение в предыдущем сообщении — для «Δ» и «−». */
  prevValue: string | null;
}

const MARK_GLYPH: Record<FieldMark, string> = {
  same: "=",
  changed: "Δ",
  added: "+",
  removed: "−",
  none: "—",
};

const MARK_TONE: Record<FieldMark, string> = {
  same: "text-muted-foreground",
  changed: "text-warn",
  added: "text-ok",
  removed: "text-destructive",
  none: "text-muted-foreground",
};

const ROW_TONE: Partial<Record<FieldMark, string>> = {
  changed: "bg-diff/25",
  added: "bg-ok/10",
  removed: "bg-destructive/5",
};

/**
 * Строки таблицы: текущие поля + метки дельты к предыдущему сообщению,
 * затем «исчезнувшие» поля предыдущего (в конце списка).
 * `prevFields === null` — предыдущего сообщения нет, дельта не считается.
 */
export function computeFieldRows(
  fields: MessageField[],
  prevFields: MessageField[] | null,
): FieldRow[] {
  const prevByName = new Map<string, MessageField>();
  for (const field of prevFields ?? []) prevByName.set(field.name, field);

  const current: FieldRow[] = fields.map((field) => {
    if (prevFields === null) return { field, mark: "none", prevValue: null };
    const prev = prevByName.get(field.name);
    if (!prev) return { field, mark: "added", prevValue: null };
    if (prev.value !== field.value) {
      return { field, mark: "changed", prevValue: prev.value };
    }
    return { field, mark: "same", prevValue: null };
  });

  if (prevFields === null) return current;

  const currentNames = new Set(fields.map((field) => field.name));
  const removed: FieldRow[] = prevFields
    .filter((field) => !currentNames.has(field.name))
    .map((field) => ({ field, mark: "removed", prevValue: field.value }));

  return [...current, ...removed];
}

/** Сколько строк отличаются от предыдущего сообщения. */
export function countFieldChanges(rows: FieldRow[]): number {
  return rows.filter(
    (row) =>
      row.mark === "changed" || row.mark === "added" || row.mark === "removed",
  ).length;
}

/**
 * Таблица полей сообщения: имя, тип, значение, дельта к предыдущему
 * сообщению и адрес байтов. Клик по адресу — переход к байтам в HEX,
 * наведение строки — подсветка поля в дампе (как у прежних карточек).
 */
export function FieldsTable({
  rows,
  packetNumber,
  hoveredFieldId,
  onHoverField,
  onSelectRange,
  ruleName,
}: {
  rows: FieldRow[];
  packetNumber: number;
  hoveredFieldId: string | null;
  onHoverField: (fieldId: string | null) => void;
  onSelectRange: (offset: number, length: number) => void;
  /** Имя активного правила модели — тултип строки с ruleId. */
  ruleName?: string | null;
}) {
  const changed = useMemo(() => countFieldChanges(rows), [rows]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b px-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        <span className="w-4 shrink-0" title="Δ к предыдущему сообщению">
          Δ
        </span>
        <span className="min-w-0 flex-1">Поле</span>
        <span className="w-12 shrink-0">Тип</span>
        <span className="min-w-0 flex-1 text-right">Значение</span>
        <span className="w-10 shrink-0 text-right">Адрес</span>
      </div>

      <div className="flex flex-col">
        {rows.map((row) => {
          const { field, mark, prevValue } = row;
          const removed = mark === "removed";
          const hovered = !removed && hoveredFieldId === field.id;

          const title = [
            removed
              ? `Поле исчезло (было: ${prevValue ?? "?"})`
              : mark === "changed" && prevValue !== null
                ? `Было: ${prevValue}`
                : null,
            field.ruleId && ruleName ? `Правило: ${ruleName}` : null,
            field.note,
          ]
            .filter(Boolean)
            .join("\n");

          return (
            <div
              key={`${mark}-${field.id}`}
              title={title || undefined}
              onMouseEnter={
                removed ? undefined : () => onHoverField(field.id)
              }
              onMouseLeave={removed ? undefined : () => onHoverField(null)}
              className={cn(
                "flex items-center gap-2 rounded px-1 py-[3px] transition-colors",
                ROW_TONE[mark],
                hovered && "bg-muted",
                removed && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "w-4 shrink-0 text-center font-mono text-[10px]",
                  MARK_TONE[mark],
                )}
                title={
                  mark === "none"
                    ? "Предыдущего сообщения нет"
                    : "Δ к предыдущему сообщению"
                }
                aria-label={
                  mark === "changed"
                    ? "Значение изменилось"
                    : mark === "added"
                      ? "Новое поле"
                      : mark === "removed"
                        ? "Поле исчезло"
                        : mark === "same"
                          ? "Без изменений"
                          : undefined
                }
              >
                {MARK_GLYPH[mark]}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {field.name}
              </span>
              <span className="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">
                {field.type}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-right font-mono text-xs",
                  mark === "changed" && "text-warn",
                )}
              >
                {field.value}
              </span>
              <span className="flex w-10 shrink-0 justify-end">
                {removed ? (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {formatOffset(field.range.offset)}
                  </span>
                ) : (
                  <ReferenceChip
                    kind="bytes"
                    label={formatOffset(field.range.offset).slice(-2)}
                    preview={`${describeRange(field.range)} · пакет #${packetNumber}`}
                    onSelect={() =>
                      onSelectRange(field.range.offset, field.range.length)
                    }
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>

      {changed > 0 ? (
        <p className="px-1 pt-1 text-[10px] text-muted-foreground">
          Изменено: {changed}
        </p>
      ) : null}
    </div>
  );
}
