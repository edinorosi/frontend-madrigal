"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Copy, Crosshair, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyHint } from "@/components/empty-hint";
import {
  HexContextMenu,
  type HexContextMenuItem,
} from "@/components/hex/hex-context-menu";
import { ReferenceChip } from "@/components/reference-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { describeRange, formatOffset } from "@/src/lib/hex";
import {
  FIELD_TYPES,
  OBSERVATION_STATUS_LABEL,
  resolveObservationStatus,
} from "@/src/lib/observations";
import { useAppStore } from "@/src/store/app";
import type {
  InterpretationStatus,
  Message,
  Observation,
  ObservationKind,
  ObservationStatus,
} from "@/src/types/domain";

/** Сколько держать обратную связь в меню перед закрытием. */
const NOTICE_MS = 700;

const INTERPRETATION_LABEL: Record<InterpretationStatus, string> = {
  parsed: "разобрано",
  partial: "частично",
  "not-parsed": "не разобрано",
};

const INTERPRETATION_TONE: Record<InterpretationStatus, string> = {
  parsed: "text-ok",
  partial: "text-warn",
  "not-parsed": "text-destructive",
};

const OBSERVATION_LABEL: Record<ObservationKind, string> = {
  comment: "комментарий",
  range: "диапазон",
  hypothesis: "гипотеза",
  field: "поле",
};

const STATUS_TONE: Record<ObservationStatus, string> = {
  draft: "text-muted-foreground",
  confirmed: "text-ok",
  refuted: "text-destructive",
  stale: "text-muted-foreground",
};

interface ObservationMenuState {
  observationId: string;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
}

/**
 * Форма правки наблюдения внутри карточки. Тот же upsert, что и при создании:
 * id, messageId, range и createdAt сохраняются, меняются только текст,
 * имя и тип.
 */
function ObservationEditForm({
  observation,
  onCancel,
  onSave,
}: {
  observation: Observation;
  onCancel: () => void;
  onSave: (observation: Observation) => Promise<void>;
}) {
  const [text, setText] = useState(observation.text ?? "");
  const [name, setName] = useState(observation.name ?? "");
  const [type, setType] = useState<string>(observation.type ?? FIELD_TYPES[0]);
  const [typeSelectOpen, setTypeSelectOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const canSave =
    observation.kind === "field"
      ? name.trim().length > 0
      : text.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const updated: Observation =
      observation.kind === "field"
        ? {
            ...observation,
            name: name.trim(),
            type,
            text: text.trim() || undefined,
          }
        : { ...observation, text: text.trim() };

    try {
      await onSave(updated);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить",
      );
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {observation.kind === "field" ? (
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
            onOpenChange={(open) => {
              setTypeSelectOpen(open);
              setOverlayOpen(open);
            }}
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
      ) : null}

      <Textarea
        autoFocus={observation.kind !== "field"}
        rows={observation.kind === "field" ? 2 : 3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          observation.kind === "field"
            ? "Комментарий к полю (необязательно)"
            : "Что здесь важно?"
        }
        className="min-h-12 text-xs"
      />

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
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

/**
 * Панель интерпретации: поля сообщения и наблюдения (§6).
 * Место под сравнение сообщений отдано соседнему ComparePicker, ниже панели.
 * ПКМ на карточке наблюдения: правка, переход к байтам, копирование, удаление.
 */
export function InterpretationPanel({
  message,
  observations,
  loading,
  onSelectRange,
  onHoverField,
  hoveredFieldId,
  onSaveObservation,
  onRemoveObservation,
}: {
  message: Message | null;
  observations: Observation[];
  loading: boolean;
  onSelectRange: (offset: number, length: number) => void;
  onHoverField: (fieldId: string | null) => void;
  hoveredFieldId: string | null;
  onSaveObservation: (observation: Observation) => Promise<void>;
  onRemoveObservation: (observationId: string) => Promise<void>;
}) {
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const [menu, setMenu] = useState<ObservationMenuState | null>(null);
  const [menuNotice, setMenuNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setMenuNotice(null);
    setMenu(null);
    setOverlayOpen(false);
  }, [setOverlayOpen]);

  const showNotice = useCallback(
    (notice: string) => {
      setMenuNotice(notice);

      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }

      noticeTimerRef.current = window.setTimeout(() => {
        setMenuNotice(null);
        setMenu(null);
        setOverlayOpen(false);
      }, NOTICE_MS);
    },
    [setOverlayOpen],
  );

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  // Esc закрывает ПКМ; hex-dump пропускает клавишу — меню держит overlayOpen.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu) closeMenu();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, closeMenu]);

  // Удалённое в другом месте наблюдение не держим в режиме правки.
  useEffect(() => {
    if (editingId && !observations.some((item) => item.id === editingId)) {
      setEditingId(null);
    }
  }, [observations, editingId]);

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-observation-id]",
      );
      const observationId = target?.dataset.observationId;
      if (!observationId) return;

      const wrap = wrapRef.current;
      if (!wrap) return;

      const rect = wrap.getBoundingClientRect();

      setMenuNotice(null);
      setOverlayOpen(true);
      setMenu({
        observationId,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        containerWidth: wrap.clientWidth,
        containerHeight: wrap.clientHeight,
      });
    },
    [setOverlayOpen],
  );

  const handleDelete = useCallback(
    async (observationId: string) => {
      try {
        await onRemoveObservation(observationId);
        closeMenu();
      } catch {
        showNotice("Не удалось удалить");
      }
    },
    [onRemoveObservation, closeMenu, showNotice],
  );

  const copyObservationText = useCallback(
    async (observation: Observation) => {
      const value =
        observation.kind === "field" ? observation.name : observation.text;
      if (!value) {
        closeMenu();
        return;
      }

      if (!navigator.clipboard) {
        showNotice("Буфер обмена недоступен");
        return;
      }

      try {
        await navigator.clipboard.writeText(value);
        showNotice("Скопировано");
      } catch {
        showNotice("Не удалось скопировать");
      }
    },
    [closeMenu, showNotice],
  );

  const menuItems = useMemo<HexContextMenuItem[]>(() => {
    if (!menu) return [];

    const target = observations.find((item) => item.id === menu.observationId);
    if (!target) return [];

    const items: HexContextMenuItem[] = [
      {
        id: "edit",
        label: "Редактировать",
        icon: Pencil,
        onSelect: () => {
          closeMenu();
          setEditingId(target.id);
        },
      },
    ];

    if (target.range) {
      items.push({
        id: "goto",
        label: "К байтам",
        icon: Crosshair,
        onSelect: () => {
          closeMenu();
          if (target.range) {
            onSelectRange(target.range.offset, target.range.length);
          }
        },
      });
    }

    const copyValue = target.kind === "field" ? target.name : target.text;
    if (copyValue) {
      items.push({
        id: "copy",
        label: "Копировать текст",
        icon: Copy,
        onSelect: () => void copyObservationText(target),
      });
    }

    // Удаление — последним, за разделителем: как «Снять выделение» в HEX.
    items.push({
      id: "delete",
      label: "Удалить",
      icon: Trash2,
      separatorBefore: true,
      onSelect: () => void handleDelete(target.id),
    });

    return items;
  }, [
    menu,
    observations,
    closeMenu,
    onSelectRange,
    copyObservationText,
    handleDelete,
  ]);

  if (!message) {
    return <EmptyHint>Выберите сообщение, чтобы увидеть его поля</EmptyHint>;
  }

  return (
    <div ref={wrapRef} className="relative h-full" onContextMenu={handleContextMenu}>
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-4 pr-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                INTERPRETATION_TONE[message.interpretation],
              )}
            >
              {INTERPRETATION_LABEL[message.interpretation]}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {message.verified ? "проверено" : "не проверено"}
            </Badge>
          </div>

          <section className="flex flex-col gap-1.5">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Поля
            </h3>

            {message.fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Модель не выделила поля в этом сообщении
              </p>
            ) : (
              <ul className="flex flex-col">
                {message.fields.map((field) => (
                  <li
                    key={field.id}
                    onMouseEnter={() => onHoverField(field.id)}
                    onMouseLeave={() => onHoverField(null)}
                    className={cn(
                      "flex flex-col gap-0.5 rounded px-1.5 py-1 transition-colors",
                      hoveredFieldId === field.id && "bg-muted",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{field.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {field.type}
                      </span>
                      <span className="ml-auto font-mono text-xs">
                        {field.value}
                      </span>
                      <ReferenceChip
                        kind="bytes"
                        label={formatOffset(field.range.offset).slice(-2)}
                        preview={`${describeRange(field.range)} · пакет #${message.packetNumber}`}
                        onSelect={() =>
                          onSelectRange(field.range.offset, field.range.length)
                        }
                      />
                    </div>
                    {field.note ? (
                      <span className="text-[10px] text-muted-foreground">
                        {field.note}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-1.5">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Наблюдения
            </h3>

            {loading ? (
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : observations.length === 0 ? (
              <p className="text-xs text-muted-foreground">Нет наблюдений</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {observations.map((observation) => {
                  const range = observation.range;
                  const status = resolveObservationStatus(observation);
                  const editing = editingId === observation.id;

                  return (
                    <li
                      key={observation.id}
                      data-observation-id={observation.id}
                      className="flex flex-col gap-1 rounded border border-border/60 px-2 py-1.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">
                          {OBSERVATION_LABEL[observation.kind]}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px]", STATUS_TONE[status])}
                        >
                          {OBSERVATION_STATUS_LABEL[status]}
                        </Badge>
                        {range && !editing ? (
                          <ReferenceChip
                            kind="observation"
                            label="к байтам"
                            preview={describeRange(range)}
                            onSelect={() =>
                              onSelectRange(range.offset, range.length)
                            }
                            className="ml-auto"
                          />
                        ) : null}
                      </div>

                      {editing ? (
                        <ObservationEditForm
                          observation={observation}
                          onCancel={() => setEditingId(null)}
                          onSave={async (updated) => {
                            await onSaveObservation(updated);
                            setEditingId(null);
                          }}
                        />
                      ) : (
                        <>
                          {observation.kind === "field" && observation.name ? (
                            <p className="font-mono text-xs">
                              {observation.name}
                              {observation.type ? (
                                <span className="text-muted-foreground">
                                  {" · "}
                                  {observation.type}
                                </span>
                              ) : null}
                            </p>
                          ) : null}

                          {observation.text ? (
                            <p className="text-xs leading-snug">
                              {observation.text}
                            </p>
                          ) : observation.kind === "field" ? null : (
                            <p className="text-xs leading-snug text-muted-foreground italic">
                              без комментария
                            </p>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>

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
    </div>
  );
}
