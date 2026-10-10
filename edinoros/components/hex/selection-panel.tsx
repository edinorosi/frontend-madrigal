"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Tag } from "lucide-react";
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
import { FIELD_TYPES } from "@/src/lib/observations";
import { isInsideRadixPortal } from "@/src/lib/radix-portal";
import type { ByteRange, Observation } from "@/src/types/domain";

export const PANEL_WIDTH = 264;

export interface PanelPlacement {
  placement: "above" | "below";
  /** Граница привязки: при "above" — нижняя кромка панели, при "below" — верхняя. */
  edge: number;
  left: number;
  containerHeight: number;
}

export type SelectionPanelMode = "actions" | "comment" | "field";

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
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
    mode === "comment" ? text.trim().length > 0 : name.trim().length > 0;

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
      mode === "comment"
        ? { ...base, kind: "comment", text: text.trim() }
        : { ...base, kind: "field", name: name.trim(), type };

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

  const style =
    placement.placement === "above"
      ? {
          left: placement.left,
          bottom: placement.containerHeight - placement.edge,
          width: PANEL_WIDTH,
        }
      : {
          left: placement.left,
          top: placement.edge,
          width: PANEL_WIDTH,
        };

  return (
    <div
      ref={rootRef}
      style={style}
      className="absolute z-20 rounded-md border bg-popover p-1.5 shadow-lg"
    >
      {mode === "actions" ? (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setMode("comment")}>
            <MessageSquarePlus className="size-3.5" />
            Комментарий
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("field")}>
            <Tag className="size-3.5" />
            Поле
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="px-0.5 font-mono text-[10px] text-muted-foreground">
            {describeRange(range)}
          </span>

          {mode === "comment" ? (
            <Textarea
              autoFocus
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Что здесь важно?"
              className="min-h-16 text-xs"
            />
          ) : (
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
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
