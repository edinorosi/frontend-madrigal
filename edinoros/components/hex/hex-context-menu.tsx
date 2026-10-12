"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { isInsideRadixPortal } from "@/src/lib/radix-portal";

export const MENU_WIDTH = 248;

export interface HexContextMenuItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Нарисовать разделитель перед пунктом. */
  separatorBefore?: boolean;
  onSelect: () => void;
}

/**
 * Контекстное меню HEX-дампа. Позиционируется в точке клика и прижимается
 * к границам области, чтобы не вылезать за неё.
 * Закрытие по Esc обрабатывает вызывающая сторона — так сохраняется каскад
 * «меню → панель → выделение».
 *
 * Клавиатура: при открытии фокус встаёт на первый пункт, стрелки и Home/End
 * ходят по пунктам, Tab закрывает меню, при закрытии фокус возвращается туда,
 * откуда меню открылось.
 */
export function HexContextMenu({
  position,
  containerWidth,
  containerHeight,
  items,
  notice,
  onClose,
}: {
  position: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  items: HexContextMenuItem[];
  /** Короткое сообщение вместо пунктов — обратная связь после действия. */
  notice: string | null;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** Элемент, державший фокус до открытия меню, — вернём его при закрытии. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      // Портальный слой Radix (Select, Popover, DropdownMenu) живёт в body
      // и для этого обработчика выглядит как клик снаружи.
      if (isInsideRadixPortal(target)) return;
      onClose();
    };

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [onClose]);

  const getButtons = useCallback(
    () =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ),
    [],
  );

  // Фокус: при мount — на первый пункт; при unmount — назад, но только если
  // фокус остался в меню или на body (не крадём его у кликнутого элемента).
  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    getButtons()[0]?.focus();

    return () => {
      const current = document.activeElement;
      const stillInMenu = rootRef.current?.contains(current);
      const returnTo = returnFocusRef.current;
      if (
        returnTo &&
        (stillInMenu || current === document.body) &&
        document.contains(returnTo)
      ) {
        returnTo.focus();
      }
    };
  }, [getButtons]);

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (notice) return;

    const buttons = getButtons();
    if (buttons.length === 0) return;

    const currentIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );

    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
        break;
      case "ArrowUp":
        nextIndex =
          currentIndex < 0
            ? buttons.length - 1
            : (currentIndex - 1 + buttons.length) % buttons.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = buttons.length - 1;
        break;
      case "Tab":
        // Tab уводит фокус из меню — меню закрывается, чтобы не осталось
        // висячим без фокуса.
        onClose();
        return;
      default:
        return;
    }

    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  const estimatedHeight = notice
    ? 36
    : items.reduce((sum, item) => sum + (item.separatorBefore ? 9 : 0) + 30, 8);

  const left = Math.max(
    4,
    Math.min(position.x, Math.max(4, containerWidth - MENU_WIDTH - 4)),
  );
  const top = Math.max(
    4,
    Math.min(position.y, Math.max(4, containerHeight - estimatedHeight - 4)),
  );

  return (
    <div
      ref={rootRef}
      style={{ left, top, width: MENU_WIDTH }}
      className="absolute z-30 rounded-md border bg-popover p-1 shadow-lg"
    >
      {notice ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{notice}</p>
      ) : (
        <ul role="menu" aria-label="Действия с байтами" className="flex flex-col">
          {items.map(({ id, label, icon: Icon, separatorBefore, onSelect }) => (
            <li
              key={id}
              role="presentation"
              className={cn(separatorBefore && "mt-1 border-t pt-1")}
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={onSelect}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
