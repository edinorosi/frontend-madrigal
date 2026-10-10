"use client";

import { useEffect, useRef, type ComponentType } from "react";
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
        <ul className="flex flex-col">
          {items.map(({ id, label, icon: Icon, separatorBefore, onSelect }) => (
            <li key={id} className={cn(separatorBefore && "mt-1 border-t pt-1")}>
              <button
                type="button"
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
