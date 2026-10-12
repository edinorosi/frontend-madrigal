"use client";

import { useState, type FormEvent } from "react";
import { anomaliesOf, coverageOf } from "@/src/lib/format";
import { describeRange } from "@/src/lib/hex";
import { useAppStore } from "@/src/store/app";

/** Нижняя строка: покрытие модели, аномалии, текущее выделение. */
export function Statusbar() {
  const messages = useAppStore((state) => state.messages);
  const selection = useAppStore((state) => state.selection);
  const activeMessageId = useAppStore((state) => state.activeMessageId);
  const gotoOffset = useAppStore((state) => state.gotoOffset);
  const setMessageFilter = useAppStore((state) => state.setMessageFilter);
  const setSidebarTab = useAppStore((state) => state.setSidebarTab);
  // В редакторе модели переход к смещению бессмыслен — прячем поле.
  const modelEditorOpen = useAppStore((state) => state.modelEditorOpen);

  const [offsetText, setOffsetText] = useState("");
  const [offsetError, setOffsetError] = useState(false);

  const coverage = coverageOf(messages);
  const anomalies = anomaliesOf(messages);

  const handleGoto = (event: FormEvent) => {
    event.preventDefault();

    const raw = offsetText.trim().toLowerCase();
    if (!raw) return;

    // Допускается десятичное (1024) и шестнадцатеричное (0x400 / 0400).
    let offset: number;
    if (/^0x[0-9a-f]+$/.test(raw)) {
      offset = Number.parseInt(raw.slice(2), 16);
    } else if (/^\d+$/.test(raw)) {
      offset = Number.parseInt(raw, 10);
    } else if (/^[0-9a-f]+$/.test(raw)) {
      offset = Number.parseInt(raw, 16);
    } else {
      offset = Number.NaN;
    }

    if (!Number.isFinite(offset)) {
      setOffsetError(true);
      window.setTimeout(() => setOffsetError(false), 1500);
      return;
    }

    gotoOffset(offset);
    setOffsetText("");
  };

  // Аномалии = «неизвестно» + «ошибка»: открываем список и ставим фильтр.
  const showAnomalies = () => {
    setMessageFilter({ status: "anomaly" });
    setSidebarTab("messages");
  };

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-sidebar px-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="opacity-70">Покрытие модели</span>
        <span className="font-mono">
          {coverage === null ? "—" : `${Math.round(coverage * 100)}%`}
        </span>
      </span>

      <span className="text-border">·</span>

      <button
        type="button"
        className="flex items-center gap-1.5 rounded px-0.5 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"
        disabled={messages.length === 0 || anomalies === 0}
        title="Показать сообщения со статусами «неизвестно» и «ошибка»"
        onClick={showAnomalies}
      >
        <span className="opacity-70">Аномалии</span>
        <span className="font-mono underline decoration-dotted underline-offset-2">
          {messages.length === 0 ? "—" : anomalies}
        </span>
      </button>

      {modelEditorOpen ? null : (
        <>
          <span className="text-border">·</span>

          <form className="flex shrink-0 items-center gap-1.5" onSubmit={handleGoto}>
            <label htmlFor="goto-offset" className="opacity-70">
              Смещение
            </label>
            <input
              id="goto-offset"
              type="text"
              inputMode="text"
              value={offsetText}
              disabled={activeMessageId === null}
              placeholder="0x…"
              aria-label="Перейти к смещению в сообщении"
              className={
                "w-20 rounded border bg-transparent px-1.5 py-0 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 " +
                (offsetError ? "border-destructive text-destructive" : "border-border")
              }
              onChange={(event) => setOffsetText(event.target.value)}
              onKeyDown={(event) => {
                // Esc здесь очищает поле; остальные обработчики пропускают Esc
                // из поля ввода (isTypingTarget), так что панели не закроются.
                if (event.key === "Escape") {
                  setOffsetText("");
                }
              }}
            />
          </form>
        </>
      )}

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
