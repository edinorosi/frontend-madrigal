"use client";

import { anomaliesOf, coverageOf } from "@/src/lib/format";
import { describeRange } from "@/src/lib/hex";
import { useAppStore } from "@/src/store/app";

/** Нижняя строка: покрытие модели, аномалии, текущее выделение. */
export function Statusbar() {
  const messages = useAppStore((state) => state.messages);
  const selection = useAppStore((state) => state.selection);

  const coverage = coverageOf(messages);
  const anomalies = anomaliesOf(messages);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-sidebar px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="opacity-70">Покрытие модели</span>
        <span className="font-mono">
          {coverage === null ? "—" : `${Math.round(coverage * 100)}%`}
        </span>
      </span>

      <span className="text-border">·</span>

      <span className="flex items-center gap-1.5">
        <span className="opacity-70">Аномалии</span>
        <span className="font-mono">
          {messages.length === 0 ? "—" : anomalies}
        </span>
      </span>

      <span className="text-border">·</span>

      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 opacity-70">Выделение</span>
        <span className="truncate font-mono">
          {selection ? describeRange(selection) : "—"}
        </span>
      </span>
    </footer>
  );
}
