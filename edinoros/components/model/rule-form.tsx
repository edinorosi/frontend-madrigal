"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HexContextMenu,
  type HexContextMenuItem,
} from "@/components/hex/hex-context-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { createId } from "@/src/lib/ids";
import { MODEL_HELP } from "@/src/lib/model-help";
import { applyModelToBytes } from "@/src/lib/parse";
import { useAppStore } from "@/src/store/app";
import type {
  MessageField,
  Model,
  ModelField,
  ModelRule,
} from "@/src/types/domain";

const FIELD_TYPES = [
  "uint8",
  "uint16be",
  "uint32be",
  "int8",
  "int16be",
  "int32be",
  "bytes",
  "string",
  "hex",
] as const;

const PARSE_STATUS_LABEL = {
  parsed: "разобрано",
  partial: "частично",
  "not-parsed": "не разобрано",
} as const;

const PARSE_STATUS_TONE: Record<string, string> = {
  parsed: "text-ok",
  partial: "text-warn",
  "not-parsed": "text-destructive",
};

/** Черновик поля: числовые offset/length как текст — для промежуточного ввода. */
interface FieldDraft {
  key: string;
  name: string;
  type: string;
  offsetMode: "number" | "end-2";
  offsetText: string;
  lengthMode: "number" | "rest" | "rest-2";
  lengthText: string;
  note: string;
}

interface RuleDraft {
  name: string;
  opcodesText: string;
  maxLenText: string;
  fields: FieldDraft[];
}

function formatOpcode(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function ruleToDraft(rule: ModelRule): RuleDraft {
  const opcodes =
    rule.condition.opcodes ??
    (rule.condition.opcode !== undefined ? [rule.condition.opcode] : []);

  return {
    name: rule.name,
    opcodesText: opcodes.map(formatOpcode).join(", "),
    maxLenText:
      rule.condition.maxMessageLength !== undefined
        ? String(rule.condition.maxMessageLength)
        : "",
    fields: rule.fields.map((field) => ({
      key: createId("fd"),
      name: field.name,
      type: field.type,
      offsetMode: field.offset === "end-2" ? "end-2" : "number",
      offsetText:
        typeof field.offset === "number" ? String(field.offset) : "",
      lengthMode:
        typeof field.length === "number" ? "number" : field.length,
      lengthText:
        typeof field.length === "number" ? String(field.length) : "",
      note: field.note ?? "",
    })),
  };
}

function parseOpcodes(text: string): { value: number[] | null; error: string | null } {
  const parts = text.split(",").map((part) => part.trim());
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();

  const out: number[] = [];
  for (const part of parts) {
    if (part === "") return { value: null, error: "пустое значение" };
    let parsed: number;
    if (/^0x[0-9a-f]+$/i.test(part)) parsed = Number.parseInt(part.slice(2), 16);
    else if (/^\d+$/.test(part)) parsed = Number(part);
    else return { value: null, error: "числа через запятую" };
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
      return { value: null, error: "диапазон 0…255" };
    }
    out.push(parsed);
  }
  return { value: out, error: null };
}

function parseStrictInt(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { value: null, error: "целое число" };
  return { value: Number(trimmed), error: null };
}

function draftToRule(
  draft: RuleDraft,
  original: ModelRule,
): { rule: ModelRule | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!draft.name.trim()) errors.name = "Имя не может быть пустым";

  let opcodes: number[] = [];
  if (draft.opcodesText.trim() !== "") {
    const parsed = parseOpcodes(draft.opcodesText);
    if (parsed.error || parsed.value === null) {
      errors.opcodes = parsed.error ?? "некорректный список";
    } else {
      opcodes = parsed.value;
    }
  }

  let maxMessageLength: number | undefined;
  if (draft.maxLenText.trim() !== "") {
    const parsed = parseStrictInt(draft.maxLenText);
    if (parsed.error || parsed.value === null || parsed.value <= 0) {
      errors.maxLen = "положительное число";
    } else {
      maxMessageLength = parsed.value;
    }
  }

  const fields: ModelField[] = [];
  for (const field of draft.fields) {
    const fieldErrors: string[] = [];
    if (!field.name.trim()) fieldErrors.push("пустое имя");

    let offset: ModelField["offset"] | null = null;
    if (field.offsetMode === "end-2") {
      offset = "end-2";
    } else {
      const parsed = parseStrictInt(field.offsetText);
      if (parsed.error || parsed.value === null) {
        fieldErrors.push("смещение — целое ≥ 0");
      } else {
        offset = parsed.value;
      }
    }

    let length: ModelField["length"] | null = null;
    if (field.lengthMode === "number") {
      const parsed = parseStrictInt(field.lengthText);
      if (parsed.error || parsed.value === null || parsed.value < 1) {
        fieldErrors.push("длина — целое ≥ 1");
      } else {
        length = parsed.value;
      }
    } else {
      length = field.lengthMode;
    }

    if (fieldErrors.length > 0) {
      errors[`field:${field.key}`] = fieldErrors.join("; ");
      continue;
    }

    fields.push({
      name: field.name.trim(),
      type: field.type,
      offset: offset as ModelField["offset"],
      length: length as ModelField["length"],
      note: field.note.trim() || undefined,
    });
  }

  if (Object.keys(errors).length > 0) return { rule: null, errors };

  const condition: ModelRule["condition"] = { ...original.condition };
  delete condition.opcode;
  delete condition.opcodes;
  delete condition.maxMessageLength;
  if (opcodes.length === 1) condition.opcode = opcodes[0];
  else if (opcodes.length > 1) condition.opcodes = opcodes;
  if (maxMessageLength !== undefined) condition.maxMessageLength = maxMessageLength;

  return {
    rule: { id: original.id, name: draft.name.trim(), condition, fields },
    errors,
  };
}

function FieldRow({ field }: { field: MessageField }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono">{field.name}</span>
      <span className="text-muted-foreground">{field.type}</span>
      <span className="font-mono text-muted-foreground">
        [{field.range.offset}..{field.range.offset + field.range.length})
      </span>
      <span className="font-mono">{field.value}</span>
    </div>
  );
}

function RulePreview({
  model,
  selectedRuleId,
}: {
  model: Model;
  selectedRuleId: string;
}) {
  const messages = useAppStore((state) => state.messages);
  const activeMessageId = useAppStore((state) => state.activeMessageId);
  const getMessageBytes = useAppStore((state) => state.getMessageBytes);

  const previewMessageId = activeMessageId ?? messages[0]?.id ?? null;
  const previewMessage =
    messages.find((item) => item.id === previewMessageId) ?? null;

  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [bytesError, setBytesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBytes(null);
    setBytesError(null);
    if (!previewMessageId) return;

    void getMessageBytes(previewMessageId)
      .then((result) => {
        if (!cancelled) setBytes(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setBytesError(
          cause instanceof Error ? cause.message : "Не удалось получить байты",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [previewMessageId, getMessageBytes]);

  const apply = useMemo(() => {
    if (!bytes) return null;
    return applyModelToBytes(bytes, model);
  }, [bytes, model]);

  const ruleFired = apply !== null && apply.ruleId === selectedRuleId;

  if (!previewMessageId) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Нет сообщения для превью — выберите сессию и сообщение.
      </p>
    );
  }

  const shownBytes = bytes ? Array.from(bytes.subarray(0, 512)) : [];

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">Превью</span>
        <span className="font-mono text-muted-foreground">
          {previewMessage
            ? `№${previewMessage.packetNumber} · ${previewMessage.id}`
            : previewMessageId}
        </span>
        {apply && ruleFired ? (
          <Badge
            variant="outline"
            className={cn(
              "px-1.5 text-[11px] font-normal",
              PARSE_STATUS_TONE[apply.status],
            )}
          >
            {PARSE_STATUS_LABEL[apply.status]}
          </Badge>
        ) : null}
        {apply && !ruleFired ? (
          <>
            <span className="text-warn">Правило не сработало</span>
            <span className="text-muted-foreground">
              {apply.ruleName
                ? `сработало: ${apply.ruleName}`
                : "ничего не сработало"}
            </span>
          </>
        ) : null}
      </div>

      {bytesError ? <p className="text-xs text-destructive">{bytesError}</p> : null}

      {!bytes && !bytesError ? <Skeleton className="h-4 w-40" /> : null}

      {apply && ruleFired && apply.fields.length > 0 ? (
        <div className="flex flex-col gap-0.5 text-xs">
          {apply.fields.map((field) => (
            <FieldRow key={field.id} field={field} />
          ))}
        </div>
      ) : null}

      {bytes && shownBytes.length > 0 ? (
        <div className="font-mono text-[11px] leading-4">
          {shownBytes.map((byte, index) => {
            const inField =
              ruleFired &&
              apply?.fields.some(
                (field) =>
                  index >= field.range.offset &&
                  index < field.range.offset + field.range.length,
              );
            return (
              <span
                key={index}
                className={cn(inField && "rounded-[2px] bg-primary/20")}
              >
                {byte.toString(16).toUpperCase().padStart(2, "0")}
                {index < shownBytes.length - 1 ? " " : ""}
              </span>
            );
          })}
          {bytes.length > shownBytes.length ? (
            <span className="text-muted-foreground"> …</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Форма правки правила (R3-в.2): имя, условия, конструктор полей.
 * Каждое валидное изменение сразу уходит наверх через onCommit (saveModel);
 * невалидное не сохраняется, ошибка показывается рядом с полем.
 */
export function RuleForm({
  model,
  rule,
  onCommit,
}: {
  model: Model;
  rule: ModelRule;
  onCommit: (rule: ModelRule) => void;
}) {
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const [draft, setDraft] = useState<RuleDraft>(() => ruleToDraft(rule));
  const [nameText, setNameText] = useState(rule.name);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{
    fieldKey: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Сброс только по смене правила: store пересоздаёт объект при каждом
  // сохранении, и сброс по объекту стёр бы текст во время набора.
  useEffect(() => {
    setDraft(ruleToDraft(rule));
    setNameText(rule.name);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule.id]);

  const commitDraft = useCallback(
    (next: RuleDraft) => {
      setDraft(next);
      const { rule: updated, errors: nextErrors } = draftToRule(next, rule);
      setErrors(nextErrors);
      if (updated) onCommit(updated);
    },
    [rule, onCommit],
  );

  const commitName = useCallback(() => {
    const name = nameText.trim();
    if (!name) {
      setErrors((prev) => ({ ...prev, name: "Имя не может быть пустым" }));
      return;
    }
    setErrors((prev) => {
      const next = { ...prev };
      delete next.name;
      return next;
    });
    if (name !== draft.name) commitDraft({ ...draft, name });
  }, [nameText, draft, commitDraft]);

  const updateFields = useCallback(
    (fn: (fields: FieldDraft[]) => FieldDraft[]) => {
      commitDraft({ ...draft, fields: fn(draft.fields) });
    },
    [draft, commitDraft],
  );

  const handleAddField = useCallback(() => {
    updateFields((fields) => [
      ...fields,
      {
        key: createId("fd"),
        name: "field",
        type: "uint8",
        offsetMode: "number",
        offsetText: "0",
        lengthMode: "number",
        lengthText: "1",
        note: "",
      },
    ]);
  }, [updateFields]);

  const openFieldMenu = useCallback(
    (fieldKey: string, event: React.MouseEvent) => {
      event.preventDefault();
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenu({
        fieldKey,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        w: rect.width,
        h: rect.height,
      });
      setOverlayOpen(true);
    },
    [setOverlayOpen],
  );

  const closeFieldMenu = useCallback(() => {
    setMenu(null);
    setOverlayOpen(false);
  }, [setOverlayOpen]);

  // Esc закрывает ПКМ поля; редактор при overlayOpen не закрывается.
  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFieldMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, closeFieldMenu]);

  const menuIndex = menu
    ? draft.fields.findIndex((field) => field.key === menu.fieldKey)
    : -1;

  const fieldMenuItems = useMemo<HexContextMenuItem[]>(() => {
    if (!menu || menuIndex < 0) return [];
    const items: HexContextMenuItem[] = [
      {
        id: "duplicate",
        label: "Дублировать",
        icon: Copy,
        onSelect: () => {
          closeFieldMenu();
          updateFields((fields) => [
            ...fields.slice(0, menuIndex + 1),
            { ...fields[menuIndex], key: createId("fd") },
            ...fields.slice(menuIndex + 1),
          ]);
        },
      },
    ];
    if (menuIndex > 0) {
      items.push({
        id: "up",
        label: "Переместить вверх",
        icon: ArrowUp,
        onSelect: () => {
          closeFieldMenu();
          updateFields((fields) => {
            const next = [...fields];
            [next[menuIndex - 1], next[menuIndex]] = [
              next[menuIndex],
              next[menuIndex - 1],
            ];
            return next;
          });
        },
      });
    }
    if (menuIndex < draft.fields.length - 1) {
      items.push({
        id: "down",
        label: "Переместить вниз",
        icon: ArrowDown,
        onSelect: () => {
          closeFieldMenu();
          updateFields((fields) => {
            const next = [...fields];
            [next[menuIndex], next[menuIndex + 1]] = [
              next[menuIndex + 1],
              next[menuIndex],
            ];
            return next;
          });
        },
      });
    }
    items.push({
      id: "delete",
      label: "Удалить",
      icon: Trash2,
      separatorBefore: true,
      onSelect: () => {
        closeFieldMenu();
        updateFields((fields) =>
          fields.filter((field) => field.key !== menu.fieldKey),
        );
      },
    });
    return items;
  }, [menu, menuIndex, draft.fields.length, closeFieldMenu, updateFields]);

  const previewModel = useMemo(() => {
    const { rule: draftRule } = draftToRule(draft, rule);
    if (!draftRule) return model;
    return {
      ...model,
      rules: model.rules.map((item) =>
        item.id === draftRule.id ? draftRule : item,
      ),
    };
    // draftToRule — чистая; пересчёт при каждом изменении черновика.
  }, [draft, rule, model]);

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Имя правила</span>
            <Input
              value={nameText}
              onChange={(event) => setNameText(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setNameText(rule.name);
                  event.currentTarget.blur();
                }
              }}
              className="h-7 text-xs"
            />
            {errors.name ? (
              <p className="text-[10px] text-destructive">{errors.name}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Условия</span>
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-xs">opcodes</span>
              <Input
                value={draft.opcodesText}
                onChange={(event) =>
                  commitDraft({ ...draft, opcodesText: event.target.value })
                }
                placeholder="0x01, 0x02, …"
                className="h-7 font-mono text-xs"
              />
            </div>
            {errors.opcodes ? (
              <p className="pl-28 text-[10px] text-destructive">
                {errors.opcodes}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-xs">maxMessageLength</span>
              <Input
                value={draft.maxLenText}
                onChange={(event) =>
                  commitDraft({ ...draft, maxLenText: event.target.value })
                }
                placeholder="—"
                className="h-7 font-mono text-xs"
              />
            </div>
            {errors.maxLen ? (
              <p className="pl-28 text-[10px] text-destructive">
                {errors.maxLen}
              </p>
            ) : null}
            {draft.opcodesText.trim() === "" &&
            draft.maxLenText.trim() === "" ? (
              <p className="text-xs text-muted-foreground">Всегда (fallback)</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Поля ({draft.fields.length})
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px]"
                onClick={handleAddField}
              >
                <Plus className="size-3" />
                Добавить поле
              </Button>
            </div>

            {draft.fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">Полей нет.</p>
            ) : null}

            {draft.fields.map((field, index) => {
              const fieldError = errors[`field:${field.key}`];
              return (
                <div
                  key={field.key}
                  onContextMenu={(event) => openFieldMenu(field.key, event)}
                  className={cn(
                    "flex flex-col gap-1 rounded border p-2",
                    fieldError ? "border-destructive/50" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <Input
                      value={field.name}
                      onChange={(event) =>
                        updateFields((fields) =>
                          fields.map((item) =>
                            item.key === field.key
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="имя"
                      title={MODEL_HELP.fieldName}
                      className="h-7 w-24 text-xs"
                    />
                    <Select
                      value={field.type}
                      onValueChange={(value) =>
                        updateFields((fields) =>
                          fields.map((item) =>
                            item.key === field.key ? { ...item, type: value } : item,
                          ),
                        )
                      }
                      onOpenChange={setOverlayOpen}
                    >
                      <SelectTrigger size="sm" className="w-28 text-xs" title={MODEL_HELP.fieldType}>
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

                    <Select
                      value={field.offsetMode}
                      onValueChange={(value) =>
                        updateFields((fields) =>
                          fields.map((item) =>
                            item.key === field.key
                              ? {
                                  ...item,
                                  offsetMode: value as FieldDraft["offsetMode"],
                                }
                              : item,
                          ),
                        )
                      }
                      onOpenChange={setOverlayOpen}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-20 text-xs"
                        title={
                          field.offsetMode === "end-2"
                            ? MODEL_HELP.fieldOffsetEnd2
                            : MODEL_HELP.fieldOffset
                        }
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="number">число</SelectItem>
                        <SelectItem value="end-2">end-2</SelectItem>
                      </SelectContent>
                    </Select>
                    {field.offsetMode === "number" ? (
                      <Input
                        value={field.offsetText}
                        onChange={(event) =>
                          updateFields((fields) =>
                            fields.map((item) =>
                              item.key === field.key
                                ? { ...item, offsetText: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="0"
                        title={MODEL_HELP.fieldOffset}
                        className="h-7 w-16 font-mono text-xs"
                      />
                    ) : null}

                    <Select
                      value={field.lengthMode}
                      onValueChange={(value) =>
                        updateFields((fields) =>
                          fields.map((item) =>
                            item.key === field.key
                              ? {
                                  ...item,
                                  lengthMode: value as FieldDraft["lengthMode"],
                                }
                              : item,
                          ),
                        )
                      }
                      onOpenChange={setOverlayOpen}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-22 text-xs"
                        title={
                          field.lengthMode === "number"
                            ? MODEL_HELP.fieldLength
                            : MODEL_HELP.fieldLengthRest
                        }
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="number">число</SelectItem>
                        <SelectItem value="rest">rest</SelectItem>
                        <SelectItem value="rest-2">rest-2</SelectItem>
                      </SelectContent>
                    </Select>
                    {field.lengthMode === "number" ? (
                      <Input
                        value={field.lengthText}
                        onChange={(event) =>
                          updateFields((fields) =>
                            fields.map((item) =>
                              item.key === field.key
                                ? { ...item, lengthText: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="1"
                        title={MODEL_HELP.fieldLength}
                        className="h-7 w-16 font-mono text-xs"
                      />
                    ) : null}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-6 shrink-0"
                      title="Удалить поле"
                      onClick={() =>
                        updateFields((fields) =>
                          fields.filter((item) => item.key !== field.key),
                        )
                      }
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0" />
                    <Input
                      value={field.note}
                      onChange={(event) =>
                        updateFields((fields) =>
                          fields.map((item) =>
                            item.key === field.key
                              ? { ...item, note: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="note (необязательно)"
                      title={MODEL_HELP.fieldNote}
                      className="h-7 flex-1 text-xs"
                    />
                  </div>

                  {fieldError ? (
                    <p className="pl-6 text-[10px] text-destructive">
                      {fieldError}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t">
        <ScrollArea className="max-h-[45vh]">
          <RulePreview model={previewModel} selectedRuleId={rule.id} />
        </ScrollArea>
      </div>

      {menu && menuIndex >= 0 ? (
        <HexContextMenu
          position={{ x: menu.x, y: menu.y }}
          containerWidth={menu.w}
          containerHeight={menu.h}
          items={fieldMenuItems}
          notice={null}
          onClose={closeFieldMenu}
        />
      ) : null}
    </div>
  );
}
