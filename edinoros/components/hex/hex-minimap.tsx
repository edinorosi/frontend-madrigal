"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import { describeRange, rangeHasIndex } from "@/src/lib/hex";
import type { ByteRange } from "@/src/types/domain";

/** Тултип не должен прилипать к самым кромкам полосы. */
const TOOLTIP_EDGE = 22;

interface HoverState {
  topPercent: number;
  heightPercent: number;
  label: string;
  /** Смещение тултипа от верха полосы, px. */
  tooltipY: number;
}

/** Позиция на полосе → пропорциональная позиция в сообщении. */
function scrollToRatio(
  ratio: number,
  element: HTMLElement,
  behavior: ScrollBehavior,
): void {
  const max = element.scrollHeight - element.clientHeight;
  if (max <= 0) return;

  const clamped = Math.min(1, Math.max(0, ratio));
  element.scrollTo({
    top: clamped * element.scrollHeight - element.clientHeight / 2,
    behavior,
  });
}

/**
 * Узкая полоса справа от HEX: навигация по длинному сообщению.
 * Остаётся тонкой и однотонной — без структуры и меток полей.
 * Показывает видимую область и текущее выделение.
 */
export function HexMinimap({
  length,
  selection,
  diffRanges,
  scrollRef,
  className,
}: {
  length: number;
  selection: ByteRange | null;
  /** Отрезки отличий — показываются в режиме сравнения. */
  diffRanges?: ByteRange[];
  scrollRef: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const clickRatioRef = useRef(0);
  const movedRef = useRef(false);

  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);

  // Видимая область: обновляется императивно, чтобы скролл не гнал ре-рендеры.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const stripEl = stripRef.current;
    const viewportEl = viewportRef.current;
    if (!scrollEl || !stripEl || !viewportEl) return;

    const update = () => {
      const { scrollHeight, clientHeight, scrollTop } = scrollEl;
      const stripHeight = stripEl.clientHeight;
      if (scrollHeight <= 0 || stripHeight <= 0) return;

      const ratio = Math.min(1, clientHeight / scrollHeight);
      const height = ratio * stripHeight;
      const maxScroll = scrollHeight - clientHeight;
      const offset =
        maxScroll > 0
          ? (scrollTop / maxScroll) * (stripHeight - height)
          : 0;

      viewportEl.style.height = `${height}px`;
      viewportEl.style.top = `${offset}px`;
      // Всё сообщение влезает — прямоугольник на всю высоту и не спорит за внимание.
      viewportEl.style.opacity = ratio >= 1 ? "0.4" : "1";

      // ARIA: слайдер сообщает видимый диапазон (императивно, чтобы не гнать
      // ре-рендеры от каждого скролла).
      const topByte = Math.min(
        length - 1,
        Math.floor((scrollTop / scrollHeight) * length),
      );
      const visibleBytes = Math.max(
        1,
        Math.floor((clientHeight / scrollHeight) * length),
      );
      const endByte = Math.min(length - 1, topByte + visibleBytes - 1);
      stripEl.setAttribute("aria-valuenow", String(topByte));
      stripEl.setAttribute(
        "aria-valuetext",
        `видны байты ${topByte}–${endByte}`,
      );
    };

    update();
    scrollEl.addEventListener("scroll", update, { passive: true });

    const observer = new ResizeObserver(update);
    observer.observe(scrollEl);
    observer.observe(stripEl);

    return () => {
      scrollEl.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollRef, length]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: MouseEvent) => {
      const stripEl = stripRef.current;
      const scrollEl = scrollRef.current;
      if (!stripEl || !scrollEl) return;

      const rect = stripEl.getBoundingClientRect();
      movedRef.current = true;
      setHover(null);
      scrollToRatio((event.clientY - rect.top) / rect.height, scrollEl, "auto");
    };

    const onUp = () => {
      const scrollEl = scrollRef.current;

      // Протяжки не было — это клик, доводим плавно.
      if (scrollEl && !movedRef.current) {
        scrollToRatio(clickRatioRef.current, scrollEl, "smooth");
      }

      setDragging(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, scrollRef]);

  const handleMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const stripEl = stripRef.current;
    if (!stripEl) return;

    // Клик по полосе переводит на неё фокус — дальше она работает с клавиатуры.
    stripEl.focus();

    const rect = stripEl.getBoundingClientRect();
    clickRatioRef.current = (event.clientY - rect.top) / rect.height;
    movedRef.current = false;
    setHover(null);
    setDragging(true);
  };

  // Клавиатура: полоса ведёт себя как ползунок прокрутки дампа.
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const page = scrollEl.clientHeight * 0.9;
    const line = 40;

    switch (event.key) {
      case "ArrowDown":
        scrollEl.scrollBy({ top: line });
        break;
      case "ArrowUp":
        scrollEl.scrollBy({ top: -line });
        break;
      case "PageDown":
        scrollEl.scrollBy({ top: page });
        break;
      case "PageUp":
        scrollEl.scrollBy({ top: -page });
        break;
      case "Home":
        scrollEl.scrollTo({ top: 0 });
        break;
      case "End":
        scrollEl.scrollTo({ top: scrollEl.scrollHeight });
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const handleHover = (event: ReactMouseEvent) => {
    if (dragging || length <= 0) return;

    const stripEl = stripRef.current;
    if (!stripEl) return;

    const rect = stripEl.getBoundingClientRect();
    const y = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const byteIndex = Math.min(length - 1, Math.floor((y / rect.height) * length));
    const span = Math.max(1, Math.round(length / rect.height));
    const last = Math.min(length - 1, byteIndex + span - 1);

    // Внутри выделения подсказываем всё выделение, иначе — диапазон под курсором.
    const onSelection = selection ? rangeHasIndex(selection, byteIndex) : false;
    const topByte = onSelection && selection ? selection.offset : byteIndex;
    const byteCount =
      onSelection && selection ? selection.length : last - byteIndex + 1;

    setHover({
      topPercent: (topByte / length) * 100,
      heightPercent: Math.max((byteCount / length) * 100, 0.7),
      label:
        onSelection && selection
          ? describeRange(selection)
          : last > byteIndex
            ? `байты ${byteIndex}–${last}`
            : `байт ${byteIndex}`,
      tooltipY: Math.min(
        Math.max(y, TOOLTIP_EDGE),
        Math.max(TOOLTIP_EDGE, rect.height - TOOLTIP_EDGE),
      ),
    });
  };

  if (length === 0) return null;

  return (
    <div className={cn("relative flex h-full", className)}>
      <div
        ref={stripRef}
        role="slider"
        tabIndex={0}
        aria-label="Мини-карта сообщения"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, length - 1)}
        aria-valuenow={0}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        onMouseMove={handleHover}
        onMouseLeave={() => setHover(null)}
        className={cn(
          "relative h-full w-3 shrink-0 overflow-hidden rounded-sm",
          "bg-muted/50 transition-colors outline-none",
          "focus-visible:ring-1 focus-visible:ring-primary",
          dragging
            ? "cursor-grabbing ring-1 ring-primary/50"
            : "cursor-pointer",
        )}
      >
        <div
          ref={viewportRef}
          className="absolute right-0 left-0 border-y border-foreground/25 bg-foreground/15"
        />

        {diffRanges?.map((range) => (
          <div
            key={`diff-${range.offset}`}
            className="absolute right-0 left-0 bg-diff"
            style={{
              top: `${(range.offset / length) * 100}%`,
              height: `max(${(range.length / length) * 100}%, 2px)`,
            }}
          />
        ))}

        {selection ? (
          <div
            className="absolute right-0 left-0 bg-primary"
            style={{
              top: `${(selection.offset / length) * 100}%`,
              height: `max(${(selection.length / length) * 100}%, 2px)`,
            }}
          />
        ) : null}

        {hover ? (
          <div
            className="absolute right-0 left-0 bg-foreground/25"
            style={{
              top: `${hover.topPercent}%`,
              height: `max(${hover.heightPercent}%, 1px)`,
            }}
          />
        ) : null}
      </div>

      {hover && !dragging ? (
        <div
          style={{ top: hover.tooltipY }}
          className="absolute right-full z-40 mr-2 -translate-y-1/2 rounded border bg-popover px-2 py-1 font-mono text-[10px] whitespace-nowrap shadow-md"
        >
          {hover.label}
        </div>
      ) : null}
    </div>
  );
}
