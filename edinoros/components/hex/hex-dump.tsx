"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Copy,
  FileSearch,
  Lightbulb,
  MessageSquarePlus,
  Tag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/src/lib/keyboard";
import {
  HexContextMenu,
  type HexContextMenuItem,
} from "@/components/hex/hex-context-menu";
import {
  SelectionPanel,
  type PanelPlacement,
  type SelectionPanelMode,
} from "@/components/hex/selection-panel";
import {
  BYTES_PER_ROW,
  byteToAscii,
  byteToHex,
  formatOffset,
  rangeBetween,
  rangeHasIndex,
  toHexText,
} from "@/src/lib/hex";
import type { ByteRange, Observation } from "@/src/types/domain";

const ROW_HEIGHT = 22;
/** Пауза после отпускания мыши: чтобы панель не мигала при перетаскивании. */
const SELECTION_SETTLE_MS = 150;
const PANEL_GAP = 6;
const PANEL_MIN_HEIGHT = 38;
/** Сколько держать обратную связь в меню перед закрытием. */
const NOTICE_MS = 700;
/** Уведомление о копировании показывается вне меню — дольше, чтобы успеть прочитать. */
const COPY_NOTICE_MS = 2000;
/** Доля высоты у края, в которой включается автопрокрутка при протяжке. */
const EDGE_BAND = 0.12;
const MIN_EDGE_BAND = 24;
/** Пикселей за кадр у самой границы. */
const AUTOSCROLL_SPEED = 16;

interface PanelState {
  range: ByteRange;
  placement: PanelPlacement;
  mode: SelectionPanelMode;
}

interface MenuState {
  x: number;
  y: number;
  byteIndex: number | null;
  containerWidth: number;
  containerHeight: number;
}

/**
 * HEX-дамп: смещение, 16 байт hex, ASCII. Виртуализирован — сообщения до 64 КиБ.
 *
 * Компонент владеет геометрией и взаимодействием: выделение мышью, панель
 * действий, контекстное меню. Данные не читает — сохранение уходит наверх
 * через onCreateObservation.
 */
export function HexDump({
  bytes,
  selection,
  highlight,
  uncoveredRanges,
  diffMask,
  onSelect,
  messageId,
  onCreateObservation,
  onShowSource,
  overlayOpen = false,
  checkActive = false,
  onStopCheck,
  compareActive = false,
  onStopCompare,
  scrollRef,
}: {
  bytes: Uint8Array;
  selection: ByteRange | null;
  /** Диапазон поля, наведённого в интерпретации. */
  highlight: ByteRange | null;
  /** Диапазоны, не покрытые моделью (R9.1) — серый слой под hover-полем. */
  uncoveredRanges?: ByteRange[] | null;
  /** Маска отличий для режима сравнения: 1 — байт отличается. */
  diffMask?: Uint8Array | null;
  onSelect: (range: ByteRange | null) => void;
  messageId: string;
  onCreateObservation: (observation: Observation) => Promise<void>;
  /** Заглушка «показать в пакете-источнике»: подсветить ссылку в шапке. */
  onShowSource?: () => void;
  /** Открыт портальный слой Radix (Select, Popover) — Esc адресован ему. */
  overlayOpen?: boolean;
  /** Открыта панель «Проверка» — Esc закрывает её раньше сравнения. */
  checkActive?: boolean;
  onStopCheck?: () => void;
  /** Активно сравнение — Esc закрывает его раньше, чем снимает выделение. */
  compareActive?: boolean;
  onStopCompare?: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const anchorRef = useRef<number | null>(null);
  const rangeRef = useRef<ByteRange | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const pointerSelectionRef = useRef(false);
  const insideSelectionRef = useRef(false);
  /** Курсор клавиатурной навигации: позиция без сдвига выделения. */
  const cursorRef = useRef(0);
  /** Последняя позиция курсора в координатах окна — нужна при автопрокрутке. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollRef = useRef<number | null>(null);

  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuNotice, setMenuNotice] = useState<string | null>(null);

  const rowCount = Math.ceil(bytes.length / BYTES_PER_ROW);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
  });

  /** Маска непокрытых байтов: 1 — байт вне покрытия модели (R9.1). */
  const uncoveredMask = useMemo(() => {
    if (!uncoveredRanges || uncoveredRanges.length === 0) return null;

    const mask = new Uint8Array(bytes.length);
    for (const range of uncoveredRanges) {
      const start = Math.max(0, range.offset);
      const end = Math.min(bytes.length, range.offset + range.length);
      for (let index = start; index < end; index += 1) {
        mask[index] = 1;
      }
    }
    return mask;
  }, [uncoveredRanges, bytes.length]);

  // rangeRef всегда отражает текущее выделение, в том числе выставленное извне.
  useEffect(() => {
    rangeRef.current = selection;
  }, [selection]);

  /** Геометрия панели: над выделением, а если места нет — под ним. */
  const computePanel = useCallback(
    (range: ByteRange): PanelState | null => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return null;

      const firstRow = Math.floor(range.offset / BYTES_PER_ROW);
      const lastRow = Math.floor(
        (range.offset + range.length - 1) / BYTES_PER_ROW,
      );

      const rowTop = firstRow * ROW_HEIGHT - scrollEl.scrollTop;
      const rowBottom = (lastRow + 1) * ROW_HEIGHT - scrollEl.scrollTop;
      const containerHeight = scrollEl.clientHeight;

      const placement: PanelPlacement["placement"] =
        rowTop >= PANEL_MIN_HEIGHT + PANEL_GAP ? "above" : "below";
      const edge =
        placement === "above" ? rowTop - PANEL_GAP : rowBottom + PANEL_GAP;

      const scrollRect = scrollEl.getBoundingClientRect();
      const cellEl = scrollEl.querySelector<HTMLElement>("[data-cell]");
      // Центр выделения по горизонтали; сама панель центрируется по нему
      // после замера своей ширины (см. SelectionPanel).
      let center = scrollEl.clientWidth / 2;

      if (cellEl) {
        const cellRect = cellEl.getBoundingClientRect();
        const startColumn = range.offset % BYTES_PER_ROW;
        const endColumn =
          (range.offset + range.length - 1) % BYTES_PER_ROW;
        center =
          cellRect.left -
          scrollRect.left +
          ((startColumn + endColumn + 1) / 2) * cellRect.width;
      }

      return {
        range,
        placement: {
          placement,
          edge,
          center,
          containerWidth: scrollEl.clientWidth,
          containerHeight,
        },
        mode: "actions",
      };
    },
    [scrollRef],
  );

  // Скролл уводит панель в сторону от её байтов — закрываем.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const onScroll = () => setPanel(null);
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  // Esc каскадом: портал Radix → ПКМ-меню → панель → «Проверка» → сравнение → выделение.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      // Esc из поля ввода завершает ввод, а не закрывает панели.
      if (isTypingTarget(event.target)) return;

      // Открытый Popover или Select закроется сам, ему и адресован Esc.
      if (overlayOpen) return;

      if (menu) {
        setMenu(null);
        return;
      }
      // Панель закрывается своим обработчиком: у неё может быть открыт вложенный
      // список, которому Esc и адресован. Здесь важно лишь не тронуть выделение.
      if (panel) return;

      if (checkActive) {
        onStopCheck?.();
        return;
      }

      if (compareActive) {
        onStopCompare?.();
        return;
      }

      if (selection) {
        onSelect(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    overlayOpen,
    menu,
    panel,
    checkActive,
    onStopCheck,
    compareActive,
    onStopCompare,
    selection,
    onSelect,
  ]);

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  // Переход к байтам по ссылке: если строка выделения вне видимой области — доводим.
  // Во время выделения мышью не вмешиваемся: selection.offset — это его начало,
  // и доведение до него откатывало бы скролл назад при протяжке.
  useEffect(() => {
    if (!selection) return;
    if (pointerSelectionRef.current) return;

    const row = Math.floor(selection.offset / BYTES_PER_ROW);
    const isVisible = virtualizer
      .getVirtualItems()
      .some((item) => item.index === row);

    if (!isVisible) {
      virtualizer.scrollToIndex(row, { align: "center" });
    }
  }, [selection, virtualizer]);

  const handleByteMouseDown = useCallback(
    (event: ReactMouseEvent, index: number) => {
      // Только левая кнопка. Правая и средняя не начинают и не сбрасывают выделение.
      if (event.button !== 0) return;
      event.preventDefault();

      // preventDefault гасит фокус по клику — ставим его сами, чтобы работали
      // стрелки и PageUp/PageDown.
      scrollRef.current?.focus({ preventScroll: true });
      cursorRef.current = index;
      pointerRef.current = { x: event.clientX, y: event.clientY };

      setMenu(null);

      if (event.shiftKey && selection) {
        const last = selection.offset + selection.length - 1;
        const range =
          index < selection.offset
            ? { offset: index, length: last - index + 1 }
            : { offset: selection.offset, length: index - selection.offset + 1 };

        anchorRef.current = index;
        insideSelectionRef.current = false;
        pointerSelectionRef.current = true;
        setDragging(true);
        onSelect(range);
        return;
      }

      // Клик внутри выделения не сбрасывает его: панель вернётся по mouseup.
      if (rangeHasIndex(selection, index)) {
        anchorRef.current = index;
        insideSelectionRef.current = true;
        pointerSelectionRef.current = true;
        setDragging(true);
        return;
      }

      anchorRef.current = index;
      insideSelectionRef.current = false;
      pointerSelectionRef.current = true;
      setDragging(true);
      onSelect({ offset: index, length: 1 });
    },
    [onSelect, scrollRef, selection],
  );

  // Стабильный диспетчер кликов: строкам нужна постоянная ссылка, а сам
  // обработчик зависит от selection — живёт в ref.
  const mouseDownRef = useRef(handleByteMouseDown);
  mouseDownRef.current = handleByteMouseDown;
  const stableByteMouseDown = useCallback(
    (event: ReactMouseEvent, index: number) => {
      mouseDownRef.current(event, index);
    },
    [],
  );

  // Курсор не должен выходить за пределы байтов при смене сообщения.
  useEffect(() => {
    if (cursorRef.current > bytes.length - 1) {
      cursorRef.current = Math.max(0, bytes.length - 1);
    }
  }, [bytes.length]);

  /**
   * Клавиатурная навигация по байтам: стрелки двигают курсор, Shift растягивает
   * выделение от якоря, Home/End — граница строки (Ctrl — потока), PageUp/Down —
   * экран, Ctrl+A — всё сообщение.
   */
  const showNotice = useCallback((message: string, duration = NOTICE_MS) => {
    setMenuNotice(message);

    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }

    noticeTimerRef.current = window.setTimeout(() => {
      setMenuNotice(null);
      setMenu(null);
    }, duration);
  }, []);

  const copyRange = useCallback(
    async (range: ByteRange) => {
      if (!navigator.clipboard) {
        showNotice("Буфер обмена недоступен");
        return;
      }

      try {
        await navigator.clipboard.writeText(toHexText(bytes, range));
        showNotice(
          `Скопировано: ${range.length} ${
            range.length === 1 ? "байт" : "байт(ов)"
          }`,
          COPY_NOTICE_MS,
        );
      } catch {
        showNotice("Не удалось скопировать");
      }
    },
    [bytes, showNotice],
  );

  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const pageSize =
        Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_HEIGHT)) *
        BYTES_PER_ROW;

      let next: number | null = null;
      switch (event.key) {
        case "ArrowRight":
          next = cursorRef.current + 1;
          break;
        case "ArrowLeft":
          next = cursorRef.current - 1;
          break;
        case "ArrowDown":
          next = cursorRef.current + BYTES_PER_ROW;
          break;
        case "ArrowUp":
          next = cursorRef.current - BYTES_PER_ROW;
          break;
        case "Home":
          next = event.ctrlKey
            ? 0
            : cursorRef.current - (cursorRef.current % BYTES_PER_ROW);
          break;
        case "End":
          next = event.ctrlKey
            ? bytes.length - 1
            : cursorRef.current -
              (cursorRef.current % BYTES_PER_ROW) +
              BYTES_PER_ROW -
              1;
          break;
        case "PageDown":
          next = cursorRef.current + pageSize;
          break;
        case "PageUp":
          next = cursorRef.current - pageSize;
          break;
        case "a":
        case "A":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            onSelect({ offset: 0, length: bytes.length });
          }
          return;
        case "c":
        case "C":
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            if (selection) {
              void copyRange(selection);
            } else {
              showNotice("Выделение отсутствует", COPY_NOTICE_MS);
            }
          }
          return;
        default:
          return;
      }

      event.preventDefault();
      const clamped = Math.max(0, Math.min(next, bytes.length - 1));
      cursorRef.current = clamped;
      virtualizer.scrollToIndex(Math.floor(clamped / BYTES_PER_ROW));

      if (event.shiftKey) {
        // Якорь — начало текущего выделения; без выделения якорь равен курсору.
        const anchor = selection?.offset ?? clamped;
        onSelect(rangeBetween(anchor, clamped));
      } else {
        onSelect({ offset: clamped, length: 1 });
      }
    },
    [
      bytes.length,
      copyRange,
      onSelect,
      scrollRef,
      selection,
      showNotice,
      virtualizer,
    ],
  );

  /**
   * Байт под точкой экрана. Считается по координатам и текущему scrollTop,
   * а не по видимым строкам: при протяжке строки уезжают из виртуального окна,
   * и опираться на них нельзя.
   */
  const byteIndexFromPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      const hit = document.elementFromPoint(clientX, clientY);
      const cell =
        hit instanceof HTMLElement
          ? hit.closest<HTMLElement>("[data-byte-index]")
          : null;

      const raw = cell?.dataset.byteIndex;
      if (raw !== undefined) return Number(raw);

      // Курсор вне ячеек — считаем по вертикали от начала содержимого.
      const scrollEl = scrollRef.current;
      if (!scrollEl) return null;

      const rect = scrollEl.getBoundingClientRect();
      const row = Math.floor(
        (clientY - rect.top + scrollEl.scrollTop) / ROW_HEIGHT,
      );
      if (row < 0) return 0;

      return Math.min(row * BYTES_PER_ROW, bytes.length - 1);
    },
    [bytes.length, scrollRef],
  );

  /** Протянуть выделение до байта, не сбрасывая якорь. */
  const selectTo = useCallback(
    (index: number) => {
      if (anchorRef.current === null) return;

      if (insideSelectionRef.current) {
        // Пока курсор на том же байте — это ещё клик, а не протяжка.
        if (index === anchorRef.current) return;
        insideSelectionRef.current = false;
      }

      onSelect(rangeBetween(anchorRef.current, index));
    },
    [onSelect],
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  /** Прокрутка у краёв, пока кнопка зажата и курсор у границы. Скорость — по близости к краю. */
  const startAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== null) return;

    const step = () => {
      const scrollEl = scrollRef.current;
      const pointer = pointerRef.current;

      if (!scrollEl || !pointer) {
        autoScrollRef.current = null;
        return;
      }

      const rect = scrollEl.getBoundingClientRect();
      const band = Math.max(MIN_EDGE_BAND, rect.height * EDGE_BAND);

      let delta = 0;
      if (pointer.y < rect.top + band) {
        const strength = Math.min(1, (rect.top + band - pointer.y) / band);
        delta = -Math.max(1, Math.round(AUTOSCROLL_SPEED * strength));
      } else if (pointer.y > rect.bottom - band) {
        const strength = Math.min(1, (pointer.y - (rect.bottom - band)) / band);
        delta = Math.max(1, Math.round(AUTOSCROLL_SPEED * strength));
      } else {
        autoScrollRef.current = null;
        return;
      }

      const before = scrollEl.scrollTop;
      scrollEl.scrollTop = before + delta;
      if (scrollEl.scrollTop === before) {
        // Дошли до края сообщения.
        autoScrollRef.current = null;
        return;
      }

      const index = byteIndexFromPoint(pointer.x, pointer.y);
      if (index !== null) selectTo(index);

      autoScrollRef.current = requestAnimationFrame(step);
    };

    autoScrollRef.current = requestAnimationFrame(step);
  }, [byteIndexFromPoint, scrollRef, selectTo]);

  // Протяжка: движение курсора, колесо под зажатой кнопкой, автопрокрутка у краёв.
  // Объявлено после функций автопрокрутки, иначе их имена в списке зависимостей
  // попали бы в temporal dead zone.
  useEffect(() => {
    if (!dragging) return;

    const scrollEl = scrollRef.current;

    const onMove = (event: MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };

      // Пока работает автопрокрутка, выделение тянет она — иначе две правки за кадр.
      if (autoScrollRef.current === null) {
        const index = byteIndexFromPoint(event.clientX, event.clientY);
        if (index !== null) selectTo(index);
      }

      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();
      const band = Math.max(MIN_EDGE_BAND, rect.height * EDGE_BAND);
      const nearEdge =
        event.clientY < rect.top + band || event.clientY > rect.bottom - band;

      if (nearEdge) {
        startAutoScroll();
      } else {
        stopAutoScroll();
      }
    };

    // Колесо под зажатой кнопкой: строки уезжают под курсор, выделение тянется следом.
    const onScroll = () => {
      const pointer = pointerRef.current;
      if (!pointer || autoScrollRef.current !== null) return;

      const index = byteIndexFromPoint(pointer.x, pointer.y);
      if (index !== null) selectTo(index);
    };

    const onUp = () => {
      stopAutoScroll();
      setDragging(false);
      anchorRef.current = null;
      insideSelectionRef.current = false;

      if (!pointerSelectionRef.current) return;
      pointerSelectionRef.current = false;

      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }

      settleTimerRef.current = window.setTimeout(() => {
        const range = rangeRef.current;
        if (!range) return;
        const next = computePanel(range);
        if (next) setPanel(next);
      }, SELECTION_SETTLE_MS);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      scrollEl?.removeEventListener("scroll", onScroll);
      stopAutoScroll();
    };
  }, [
    dragging,
    byteIndexFromPoint,
    selectTo,
    startAutoScroll,
    stopAutoScroll,
    computePanel,
    scrollRef,
  ]);

  const openPanelFromMenu = useCallback(
    (range: ByteRange, mode: SelectionPanelMode) => {
      const next = computePanel(range);
      if (next) setPanel({ ...next, mode });
      setMenu(null);
    },
    [computePanel],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      const scrollEl = scrollRef.current;
      if (!scrollEl) return;

      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-byte-index]",
      );
      const raw = target?.dataset.byteIndex;
      const byteIndex = raw === undefined ? null : Number(raw);

      // Без выделения меню показывать не над чем.
      if (!selection && byteIndex === null) return;

      const rect = scrollEl.getBoundingClientRect();

      // Клавиатурный вызов (Shift+F10/ContextMenu) даёт clientX/Y = 0:
      // привязываемся к ячейке выделения, а не к углу области.
      let x = event.clientX - rect.left;
      let y = event.clientY - rect.top;
      if (event.clientX === 0 && event.clientY === 0) {
        const anchorIndex = byteIndex ?? selection?.offset ?? 0;
        const cell = scrollEl.querySelector<HTMLElement>(
          `[data-byte-index="${anchorIndex}"]`,
        );
        if (cell) {
          const cellRect = cell.getBoundingClientRect();
          x = cellRect.left - rect.left;
          y = cellRect.bottom - rect.top;
        } else {
          // Ячейка не отрисована (вне вьюпорта) — начало области.
          x = 8;
          y = 8;
        }
      }

      setPanel(null);
      setMenuNotice(null);
      setMenu({
        x,
        y,
        byteIndex,
        containerWidth: scrollEl.clientWidth,
        containerHeight: scrollEl.clientHeight,
      });
    },
    [scrollRef, selection],
  );

  const closeMenu = useCallback(() => {
    setMenuNotice(null);
    setMenu(null);
  }, []);

  const menuItems = useMemo<HexContextMenuItem[]>(() => {
    if (!menu) return [];

    if (selection) {
      const target = selection;
      return [
        {
          id: "comment",
          label: "Создать комментарий",
          icon: MessageSquarePlus,
          onSelect: () => openPanelFromMenu(target, "comment"),
        },
        {
          id: "field",
          label: "Создать поле",
          icon: Tag,
          onSelect: () => openPanelFromMenu(target, "field"),
        },
        {
          id: "hypothesis",
          label: "Создать гипотезу",
          icon: Lightbulb,
          onSelect: () => openPanelFromMenu(target, "hypothesis"),
        },
        {
          id: "copy",
          label: "Скопировать байты (hex)",
          icon: Copy,
          onSelect: () => void copyRange(target),
        },
        {
          id: "source",
          label: "Показать в пакете-источнике",
          icon: FileSearch,
          onSelect: () => {
            onShowSource?.();
            closeMenu();
          },
        },
        {
          id: "clear",
          label: "Снять выделение",
          icon: X,
          separatorBefore: true,
          onSelect: () => {
            onSelect(null);
            closeMenu();
          },
        },
      ];
    }

    const index = menu.byteIndex;
    if (index === null) return [];

    return [
      {
        id: "copy-byte",
        label: "Скопировать байт (hex)",
        icon: Copy,
        onSelect: () => void copyRange({ offset: index, length: 1 }),
      },
      {
        id: "source",
        label: "Показать в пакете-источнике",
        icon: FileSearch,
        onSelect: () => {
          onShowSource?.();
          closeMenu();
        },
      },
    ];
  }, [menu, selection, openPanelFromMenu, copyRange, onShowSource, closeMenu, onSelect]);

  if (bytes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground">
          В этом сообщении нет байтов
        </p>
      </div>
    );
  }

  const contextByte = selection ? null : (menu?.byteIndex ?? null);

  const selectionAnnounce = selection
    ? `Выделено ${selection.length} байт с offset ${selection.offset}`
    : "Выделения нет";

  return (
    <div className="relative h-full min-h-0">
      <div aria-live="polite" className="sr-only">
        {selectionAnnounce}
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        role="grid"
        aria-label="HEX-дамп"
        aria-rowcount={rowCount}
        onContextMenu={handleContextMenu}
        onKeyDown={handleGridKeyDown}
        className="no-scrollbar h-full overflow-auto font-mono text-xs select-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => (
            <HexRow
              key={row.key}
              rowIndex={row.index}
              top={row.start}
              height={row.size}
              bytes={bytes}
              selectionStart={selection ? selection.offset : null}
              selectionEnd={
                selection ? selection.offset + selection.length : null
              }
              highlightStart={highlight ? highlight.offset : null}
              highlightEnd={
                highlight ? highlight.offset + highlight.length : null
              }
              contextByte={contextByte}
              diffMask={diffMask ?? null}
              uncoveredMask={uncoveredMask ?? null}
              onByteMouseDown={stableByteMouseDown}
            />
          ))}
        </div>
      </div>

      {menu ? (
        <HexContextMenu
          position={{ x: menu.x, y: menu.y }}
          containerWidth={menu.containerWidth}
          containerHeight={menu.containerHeight}
          items={menuItems}
          notice={menuNotice}
          onClose={closeMenu}
        />
      ) : null}

      {/* Уведомление без открытого меню (Ctrl+C, ошибки буфера). */}
      {menuNotice && !menu ? (
        <div
          role="status"
          className="pointer-events-none absolute right-3 bottom-3 z-20 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md text-muted-foreground"
        >
          {menuNotice}
        </div>
      ) : null}

      {panel ? (
        <SelectionPanel
          key={`${panel.range.offset}-${panel.range.length}-${panel.mode}`}
          range={panel.range}
          messageId={messageId}
          placement={panel.placement}
          initialMode={panel.mode}
          onClose={() => setPanel(null)}
          onSave={onCreateObservation}
        />
      ) : null}
    </div>
  );
}

/**
 * Строка HEX-дампа. Мемоизирована: при протяжке мышью перерисовываются
 * только строки, чьи выделение/подсветка реально изменились (границы
 * передаются числами, а не новым объектом ByteRange).
 */
const HexRow = memo(function HexRow({
  rowIndex,
  top,
  height,
  bytes,
  selectionStart,
  selectionEnd,
  highlightStart,
  highlightEnd,
  contextByte,
  diffMask,
  uncoveredMask,
  onByteMouseDown,
}: {
  rowIndex: number;
  top: number;
  height: number;
  bytes: Uint8Array;
  selectionStart: number | null;
  selectionEnd: number | null;
  highlightStart: number | null;
  highlightEnd: number | null;
  contextByte: number | null;
  diffMask: Uint8Array | null;
  uncoveredMask: Uint8Array | null;
  onByteMouseDown: (event: ReactMouseEvent, index: number) => void;
}) {
  const rowStart = rowIndex * BYTES_PER_ROW;

  const inRange = (
    start: number | null,
    end: number | null,
    index: number,
  ) => start !== null && end !== null && index >= start && index < end;

  return (
    <div
      data-row
      role="row"
      aria-rowindex={rowIndex + 1}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height,
        transform: `translateY(${top}px)`,
      }}
      className="flex items-center leading-none"
    >
      <span
        role="rowheader"
        className="w-[4.5rem] shrink-0 pl-1 text-muted-foreground/70"
      >
        {formatOffset(rowStart)}
      </span>

      <span role="presentation" className="flex shrink-0">
        {Array.from({ length: BYTES_PER_ROW }, (_, column) => {
          const index = rowStart + column;
          const exists = index < bytes.length;
          const selected = inRange(selectionStart, selectionEnd, index);
          const highlighted = inRange(highlightStart, highlightEnd, index);
          const targeted = contextByte === index;
          const diffed = diffMask?.[index] === 1;
          const uncovered = uncoveredMask?.[index] === 1;

          return (
            <span
              key={column}
              role="gridcell"
              aria-selected={selected || undefined}
              data-cell={column === 0 ? "" : undefined}
              data-byte-index={exists ? index : undefined}
              onMouseDown={
                exists
                  ? (event) => onByteMouseDown(event, index)
                  : undefined
              }
              className={cn(
                "w-[1.35rem] shrink-0 cursor-default text-center",
                !exists && "opacity-0",
                selected && "bg-primary/30 text-foreground",
                !selected && diffed && "bg-diff/40",
                !selected && !diffed && highlighted && "bg-warn/25",
                !selected && !diffed && !highlighted && uncovered && "bg-muted/60",
                !selected && !diffed && !highlighted && "hover:bg-muted",
                targeted && "bg-primary/20 ring-1 ring-primary",
              )}
            >
              {byteToHex(bytes[index])}
            </span>
          );
        })}
      </span>

      <span
        role="presentation"
        className="ml-3 flex shrink-0 border-l border-border pl-3"
      >
        {Array.from({ length: BYTES_PER_ROW }, (_, column) => {
          const index = rowStart + column;
          const exists = index < bytes.length;
          const selected = inRange(selectionStart, selectionEnd, index);
          const highlighted = inRange(highlightStart, highlightEnd, index);
          const targeted = contextByte === index;
          const diffed = diffMask?.[index] === 1;
          const uncovered = uncoveredMask?.[index] === 1;

          return (
            <span
              key={column}
              aria-hidden="true"
              data-byte-index={exists ? index : undefined}
              onMouseDown={
                exists ? (event) => onByteMouseDown(event, index) : undefined
              }
              className={cn(
                "w-[0.62rem] shrink-0 text-center text-muted-foreground",
                !exists && "opacity-0",
                selected && "bg-primary/30 text-foreground",
                !selected && diffed && "bg-diff/40",
                !selected && !diffed && highlighted && "bg-warn/25",
                !selected && !diffed && !highlighted && uncovered && "bg-muted/60",
                targeted && "bg-primary/20 ring-1 ring-primary",
              )}
            >
              {byteToAscii(bytes[index])}
            </span>
          );
        })}
      </span>
    </div>
  );
});
