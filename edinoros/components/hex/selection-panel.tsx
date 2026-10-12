"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Lightbulb, MessageSquarePlus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { describeRange } from "@/src/lib/hex";
import { createId } from "@/src/lib/ids";
import { isTypingTarget } from "@/src/lib/keyboard";
import { FIELD_TYPES } from "@/src/lib/observations";
import { isInsideRadixPortal } from "@/src/lib/radix-portal";
import type { ByteRange, Observation } from "@/src/types/domain";

export interface PanelPlacement {
  placement: "above" | "below";
  /** Граница привязки: при "above" — нижняя кромка панели, при "below" — верхняя. */
  edge: number;
  /** Центр выделения по горизонтали, px от левого края контейнера. */
  center: number;
  containerWidth: number;
  containerHeight: number;
}

export type SelectionPanelMode = "actions" | "comment" | "field" | "hypothesis";

/**
 * Панель действий над выделенными байтами.
 * Появляется после окончания выделения, не перекрывает выделенные байты:
 * ставится над ними, а если места нет — под ними.
 *
 * `initialMode` задаёт стартовое состояние: из контекстного меню панель
 * открывается сразу формой, а не списком кнопок.
 */
export function SelectionPanel({
  range,
  messageId,
  placement,
  initialMode = "actions",
  onClose,
  onSave,
}: {
  range: ByteRange;
  messageId: string;
  placement: PanelPlacement;
  initialMode?: SelectionPanelMode;
  onClose: () => void;
  onSave: (observation: Observation) => Promise<void>;
}) {
  const [mode, setMode] = useState<SelectionPanelMode>(initialMode);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(FIELD_TYPES[0]);
  const [typeSelectOpen, setTypeSelectOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Реальная ширина панели: контент по ширине зависит от mode, замеряем после рендера.
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const width = rootRef.current?.offsetWidth;
    if (typeof width === "number" && width > 0) {
      setMeasuredWidth(width);
    }
  }, [mode, saving, error]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc из поля ввода завершает ввод, а не закрывает панель.
      if (isTypingTarget(event.target)) return;
      // Esc принадлежит открытому списку: панель закрывать ещё рано.
      if (typeSelectOpen) return;
      event.stopPropagation();
      onClose();
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      // Список типов живёт в портале в body — это не «клик вне панели».
      if (isInsideRadixPortal(target)) return;
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose, typeSelectOpen]);

  const canSave =
    mode === "field" ? name.trim().length > 0 : text.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const base = {
      id: createId("obs"),
      messageId,
      range,
      status: "draft" as const,
      createdAt: new Date().toISOString(),
    };

    const observation: Observation =
      mode === "field"
        ? { ...base, kind: "field", name: name.trim(), type }
        : mode === "hypothesis"
          ? { ...base, kind: "hypothesis", text: text.trim() }
          : { ...base, kind: "comment", text: text.trim() };

    try {
      await onSave(observation);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить",
      );
      setSaving(false);
    }
  };

  // Панель по контенту; центрируем по центру выделения, зажимаем в границы
  // контейнера. До первого замера ширины — скрыта, чтобы не «прыгала».
  const left =
    measuredWidth === null
      ? placement.center
      : Math.max(
          4,
          Math.min(
            placement.center - measuredWidth / 2,
            placement.containerWidth - measuredWidth - 4,
          ),
        );

  const style =
    placement.placement === "above"
      ? {
          left,
          bottom: placement.containerHeight - placement.edge,
          visibility: measuredWidth === null ? ("hidden" as const) : undefined,
        }
      : {
          left,
          top: placement.edge,
          visibility: measuredWidth === null ? ("hidden" as const) : undefined,
        };

  return (
    <div
      ref={rootRef}
      style={style}
      className="absolute z-20 w-fit rounded-md border bg-popover p-1.5 shadow-lg"
    >
      {mode === "actions" ? (
        <div className="flex items-center gap-1 whitespace-nowrap">
          <Button size="sm" variant="ghost" onClick={() => setMode("comment")}>
            <MessageSquarePlus className="size-3.5" />
            Комментарий
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("field")}>
            <Tag className="size-3.5" />
            Поле
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMode("hypothesis")}
          >
            <Lightbulb className="size-3.5" />
            Гипотеза
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="px-0.5 font-mono text-[10px] text-muted-foreground">
            {describeRange(range)}
          </span>

          {mode === "hypothesis" ? (
            <span className="px-0.5 text-[10px] font-medium text-muted-foreground">
              Создать гипотезу
            </span>
          ) : null}

          {mode === "field" ? (
            <div className="flex flex-col gap-1.5">
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="имя поля"
                className="h-7 text-xs"
              />
              <Select
                value={type}
                onValueChange={setType}
                onOpenChange={setTypeSelectOpen}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full text-xs"
                  aria-label="Тип поля"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Тип вне списка (из данных/бэка) показываем явно, а не
                      пустым триггером. */}
                  {!(FIELD_TYPES as readonly string[]).includes(type) ? (
                    <SelectItem value={type}>{type}</SelectItem>
                  ) : null}
                  {FIELD_TYPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Textarea
              autoFocus
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                mode === "hypothesis"
                  ? "Формулировка гипотезы"
                  : "Что здесь важно?"
              }
              className="min-h-16 text-xs"
            />
          )}

          {error ? (
            <p className="px-0.5 text-[10px] text-destructive">{error}</p>
          ) : null}

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              disabled={saving || !canSave}
              onClick={() => void handleSave()}
            >
              Сохранить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={onClose}
            >
              Отмена
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
