"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { MessageField } from "@/src/types/domain";

type CompareMark = "same" | "diff" | "onlyA" | "onlyB";

interface CompareFieldRow {
  name: string;
  type: string;
  valueA: string | null;
  valueB: string | null;
  fieldA: MessageField | null;
  mark: CompareMark;
}

const MARK_GLYPH: Record<CompareMark, string> = {
  same: "=",
  diff: "Δ",
  onlyA: "−",
  onlyB: "+",
};

const MARK_TONE: Record<CompareMark, string> = {
  same: "text-muted-foreground",
  diff: "text-warn",
  onlyA: "text-destructive",
  onlyB: "text-ok",
};

const ROW_TONE: Partial<Record<CompareMark, string>> = {
  diff: "bg-diff/10",
  onlyA: "bg-destructive/8",
  onlyB: "bg-ok/8",
};

/** Слияние полей двух сообщений по имени: общие, только A, только B. */
function compareRows(
  fieldsA: MessageField[],
  fieldsB: MessageField[],
): CompareFieldRow[] {
  const mapB = new Map<string, MessageField>();
  for (const field of fieldsB) mapB.set(field.name, field);

  const rows: CompareFieldRow[] = fieldsA.map((field) => {
    const other = mapB.get(field.name);
    if (!other) {
      return {
        name: field.name,
        type: field.type,
        valueA: field.value,
        valueB: null,
        fieldA: field,
        mark: "onlyA",
      };
    }
    const same = other.value === field.value;
    return {
      name: field.name,
      type: same ? field.type : `${field.type} / ${other.type}`,
      valueA: field.value,
      valueB: other.value,
      fieldA: field,
      mark: same ? "same" : "diff",
    };
  });

  const namesA = new Set(fieldsA.map((field) => field.name));
  for (const field of fieldsB) {
    if (namesA.has(field.name)) continue;
    rows.push({
      name: field.name,
      type: field.type,
      valueA: null,
      valueB: field.value,
      fieldA: null,
      mark: "onlyB",
    });
  }

  return rows;
}

/**
 * Секция «Поля A vs B» панели сравнения: поля двух сообщений соединены
 * по имени, расхождения помечены. Клик по строке — переход к байтам
 * поля в сообщении A (в B байтов в дампе нет).
 */
export function CompareFields({
  fieldsA,
  fieldsB,
  onSelectRangeA,
}: {
  fieldsA: MessageField[];
  fieldsB: MessageField[];
  onSelectRangeA: (offset: number, length: number) => void;
}) {
  const rows = useMemo(() => compareRows(fieldsA, fieldsB), [fieldsA, fieldsB]);
  const changed = rows.filter((row) => row.mark !== "same").length;

  if (rows.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Поля A / B
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {changed > 0 ? `Расхождений: ${changed}` : "без расхождений"}
        </span>
      </div>

      <div className="flex flex-col rounded border border-border/60">
        <div className="flex items-center gap-2 border-b px-1.5 pb-1 pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          <span className="w-4 shrink-0" title="Δ между A и B">
            Δ
          </span>
          <span className="min-w-0 flex-1">Поле</span>
          <span className="min-w-0 flex-1 text-right">A</span>
          <span className="min-w-0 flex-1 text-right">B</span>
        </div>

        {rows.map((row) => (
          <button
            key={`${row.mark}-${row.name}`}
            type="button"
            disabled={row.fieldA === null}
            title={
              row.mark === "onlyA"
                ? "Поле есть только в A"
                : row.mark === "onlyB"
                  ? "Поле есть только в B"
                  : row.mark === "diff"
                    ? `${row.valueA} → ${row.valueB}`
                    : "Без расхождений"
            }
            onClick={() => {
              if (row.fieldA) {
                onSelectRangeA(row.fieldA.range.offset, row.fieldA.range.length);
              }
            }}
            className={cn(
              "flex items-center gap-2 px-1.5 py-[3px] text-left",
              row.fieldA
                ? "transition-colors hover:bg-muted"
                : "cursor-default",
              ROW_TONE[row.mark],
            )}
          >
            <span
              className={cn(
                "w-4 shrink-0 text-center font-mono text-[10px]",
                MARK_TONE[row.mark],
              )}
            >
              {MARK_GLYPH[row.mark]}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {row.name}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-right font-mono text-[11px]",
                row.valueA === null && "text-muted-foreground",
              )}
            >
              {row.valueA ?? "—"}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-right font-mono text-[11px]",
                row.mark === "diff" && "text-warn",
                row.valueB === null && "text-muted-foreground",
              )}
            >
              {row.valueB ?? "—"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
