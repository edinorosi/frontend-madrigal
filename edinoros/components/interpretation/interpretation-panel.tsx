"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Check,
  ChevronLeft,
  Circle,
  CircleDot,
  Copy,
  Crosshair,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/src/lib/keyboard";
import { EmptyHint } from "@/components/empty-hint";
import {
  HexContextMenu,
  type HexContextMenuItem,
} from "@/components/hex/hex-context-menu";
import { ReferenceChip } from "@/components/reference-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  MODEL_STATUS_LABEL,
  MODEL_STATUS_TONE,
} from "@/src/lib/model-status";
import { applyModelCached } from "@/src/lib/parse";
import {
  FIELD_TYPES,
  OBSERVATION_STATUSES,
  OBSERVATION_STATUS_LABEL,
  resolveObservationStatus,
} from "@/src/lib/observations";
import { useAppStore, type FieldsSource } from "@/src/store/app";
import type {
  InterpretationStatus,
  Message,
  Observation,
  ObservationKind,
  ObservationStatus,
} from "@/src/types/domain";

/** Сколько держать обратную связь в меню перед закрытием. */
const NOTICE_MS = 700;

/** Сколько непокрытых диапазонов перечислять, прежде чем оставить счётчик. */
const UNCOVERED_LIMIT = 6;

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

/** Подписи статусов для меню — с заглавной, в отличие от бейджа. */
const STATUS_MENU_LABEL: Record<ObservationStatus, string> = {
  draft: "Черновик",
  confirmed: "Проверена",
  refuted: "Опровергнута",
  stale: "Устарела",
};

interface ObservationMenuState {
  observationId: string;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  /** Второй уровень меню: выбор статуса. */
  level: "root" | "status";
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
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving && canSave) void handleSave();
      }}
      onKeyDown={(event) => {
        // Esc из поля ввода или с кнопки — отмена правки. Открытый список
        // типов закрывается своим Esc, форме его не трогать.
        if (event.key === "Escape" && !typeSelectOpen) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      {observation.kind === "field" ? (
        <div className="flex flex-col gap-1.5">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="имя поля"
            aria-label="Имя поля"
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
            <SelectTrigger size="sm" className="w-full text-xs" aria-label="Тип поля">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Тип вне списка (из данных/бэка) показываем явно, а не пустым
                  триггером. */}
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
      ) : null}

      <Textarea
        autoFocus={observation.kind !== "field"}
        rows={observation.kind === "field" ? 2 : 3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Ctrl/Cmd+Enter — сохранить; Enter в многострочном — перенос.
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (!saving && canSave) void handleSave();
          }
        }}
        aria-label="Комментарий"
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
        <Button type="submit" size="sm" disabled={saving || !canSave}>
          Сохранить
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={saving}
          onClick={onCancel}
        >
          Отмена
        </Button>
      </div>
    </form>
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
  const fieldsSource = useAppStore((state) => state.fieldsSource);
  const setFieldsSource = useAppStore((state) => state.setFieldsSource);
  const bytes = useAppStore((state) => state.bytes);
  const models = useAppStore((state) => state.models);
  const activeModelId = useAppStore((state) => state.activeModelId);
  const activeModel = models?.find((item) => item.id === activeModelId) ?? null;

  /** Имена правил по id — подпись «правило: X» у наблюдений (R9.2). */
  const ruleNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of models ?? []) {
      for (const rule of model.rules) {
        map.set(rule.id, rule.name);
      }
    }
    return map;
  }, [models]);

  /**
   * Клиентский разбор (R3-б): поля считаются из байтов и правил активной
   * модели. Кэш — в applyModelCached, пересчёта на рендере нет.
   */
  const modelApply = useMemo(() => {
    if (fieldsSource !== "model" || !bytes || !activeModel || !message) {
      return null;
    }
    return applyModelCached(message.id, bytes, activeModel);
  }, [fieldsSource, bytes, activeModel, message]);

  const displayedFields =
    fieldsSource === "model" ? (modelApply?.fields ?? []) : message?.fields ?? [];

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
      // Esc из поля ввода завершает ввод, а не закрывает меню.
      if (isTypingTarget(event.target)) return;
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
        level: "root",
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

  const handleChangeStatus = useCallback(
    async (observation: Observation, status: ObservationStatus) => {
      try {
        await onSaveObservation({ ...observation, status });
        closeMenu();
      } catch {
        showNotice("Не удалось изменить статус");
      }
    },
    [onSaveObservation, closeMenu, showNotice],
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

    // Второй уровень: выбор статуса, текущий отмечен галочкой.
    if (menu.level === "status") {
      const current = resolveObservationStatus(target);
      return [
        {
          id: "status-back",
          label: "Назад",
          icon: ChevronLeft,
          onSelect: () => setMenu({ ...menu, level: "root" }),
        },
        ...OBSERVATION_STATUSES.map<HexContextMenuItem>((status) => ({
          id: `status-${status}`,
          label: STATUS_MENU_LABEL[status],
          icon: status === current ? Check : Circle,
          onSelect: () => void handleChangeStatus(target, status),
        })),
      ];
    }

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
      {
        id: "status",
        label: "Изменить статус",
        icon: CircleDot,
        onSelect: () => setMenu({ ...menu, level: "status" }),
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
    handleChangeStatus,
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
            <div className="flex items-center gap-1.5">
              <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Поля
              </h3>
              {fieldsSource === "model" && activeModel ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "px-1.5 text-[10px] font-normal",
                    MODEL_STATUS_TONE[activeModel.status],
                  )}
                  title={`Модель: ${activeModel.name}`}
                >
                  {activeModel.name} · {MODEL_STATUS_LABEL[activeModel.status]} ·{" "}
                  {displayedFields.length} пол.
                </Badge>
              ) : null}
              {fieldsSource === "model" && modelApply && modelApply.status !== "parsed" ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    modelApply.status === "partial" ? "text-warn" : "text-destructive",
                  )}
                >
                  {modelApply.status === "partial" ? "частично" : "не разобрано"}
                </Badge>
              ) : null}
              {fieldsSource === "model" && modelApply?.ruleName ? (
                <span className="text-[10px] text-muted-foreground">
                  правило: {modelApply.ruleName}
                </span>
              ) : null}
              <div className="ml-auto">
                <Select
                  value={fieldsSource}
                  onValueChange={(value) => setFieldsSource(value as FieldsSource)}
                  onOpenChange={(open) => setOverlayOpen(open)}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-6 w-[104px] text-[10px]"
                    aria-label="Источник полей"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="model" disabled={!activeModel}>
                      Модель
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {fieldsSource === "model" && !activeModel ? (
              <p className="text-xs text-muted-foreground">
                Активная модель не выбрана
              </p>
            ) : fieldsSource === "model" && !bytes ? (
              <p className="text-xs text-muted-foreground">Загрузка байтов…</p>
            ) : fieldsSource === "model" && modelApply?.status === "not-parsed" ? (
              <p className="text-xs text-muted-foreground">
                Ни одно правило модели не подошло
              </p>
            ) : displayedFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Модель не выделила поля в этом сообщении
              </p>
            ) : (
              <ul className="flex flex-col">
                {displayedFields.map((field) => (
                  <li
                    key={field.id}
                    title={
                      field.ruleId && modelApply?.ruleName
                        ? `Правило: ${modelApply.ruleName}`
                        : undefined
                    }
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
                    {field.note || (field.ruleId && fieldsSource === "model") ? (
                      <span className="text-[10px] text-muted-foreground">
                        {[
                          field.note,
                          field.ruleId && fieldsSource === "model"
                            ? `правило: ${modelApply?.ruleName ?? field.ruleId}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                </li>
              ))}
              </ul>
            )}

            {/* Непокрытые области (R9.1): байты, которые правило не описало. */}
            {fieldsSource === "model" &&
            modelApply?.status === "partial" &&
            modelApply.uncovered.length > 0 ? (
              <div className="flex flex-col gap-1 rounded border border-border/60 px-2 py-1.5">
                <span className="text-[10px] text-muted-foreground">
                  Непокрытые байты
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {modelApply.uncovered
                    .slice(0, UNCOVERED_LIMIT)
                    .map((range, index) => (
                      <ReferenceChip
                        key={`${range.offset}-${index}`}
                        kind="bytes"
                        label={describeRange(range)}
                        preview="Перейти к непокрытым байтам"
                        onSelect={() =>
                          onSelectRange(range.offset, range.length)
                        }
                      />
                    ))}
                  {modelApply.uncovered.length > UNCOVERED_LIMIT ? (
                    <span className="text-[10px] text-muted-foreground">
                      и ещё {modelApply.uncovered.length - UNCOVERED_LIMIT}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
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
                        <DropdownMenu
                          onOpenChange={(open) => setOverlayOpen(open)}
                        >
                          <DropdownMenuTrigger asChild>
                            <Badge
                              variant="outline"
                              className={cn(
                                "cursor-pointer text-[10px]",
                                STATUS_TONE[status],
                              )}
                            >
                              {OBSERVATION_STATUS_LABEL[status]}
                            </Badge>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="min-w-32">
                            {OBSERVATION_STATUSES.map((item) => (
                              <DropdownMenuCheckboxItem
                                key={item}
                                checked={item === status}
                                onCheckedChange={() =>
                                  void handleChangeStatus(observation, item)
                                }
                                className="text-xs"
                              >
                                {STATUS_MENU_LABEL[item]}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {observation.ruleId ? (
                          <span className="text-[10px] text-muted-foreground">
                            правило:{" "}
                            {ruleNamesById.get(observation.ruleId) ??
                              "удалённое правило"}
                          </span>
                        ) : null}
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
