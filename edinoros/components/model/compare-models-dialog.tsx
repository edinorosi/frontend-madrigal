"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { applyModelCached } from "@/src/lib/parse";
import {
  diffModels,
  type ModelDiffResult,
  type ModelFieldDiff,
  type ModelRuleDiff,
} from "@/src/lib/model-diff";
import { MODEL_STATUS_LABEL } from "@/src/lib/model-status";
import { appService } from "@/src/services";
import { useAppStore } from "@/src/store/app";
import type { Message, Model, ModelRule } from "@/src/types/domain";

/** Сколько сообщений прогоняем по умолчанию. */
const DEFAULT_LIMIT = 100;

type DiffMark = ModelRuleDiff["type"] | ModelFieldDiff["type"];

const MARK_GLYPH: Record<DiffMark, string> = {
  unchanged: "=",
  changed: "Δ",
  removed: "−",
  added: "+",
};

const MARK_TONE: Record<DiffMark, string> = {
  unchanged: "text-muted-foreground",
  changed: "text-warn",
  removed: "text-destructive",
  added: "text-ok",
};

const ROW_TONE: Partial<Record<DiffMark, string>> = {
  changed: "bg-diff/10",
  removed: "bg-destructive/8",
  added: "bg-ok/8",
};

/** Описание расхождения A/B для строки таблицы. */
function describeDataDiff(
  a: { status: string; fields: string[] },
  b: { status: string; fields: string[] },
): string {
  if (a.status !== b.status) {
    const statusLabel: Record<string, string> = {
      parsed: "разобрано",
      partial: "частично",
      "not-parsed": "не разобрано",
    };
    return `статус: ${statusLabel[a.status] ?? a.status} → ${statusLabel[b.status] ?? b.status}`;
  }
  const onlyA = a.fields.filter((name) => !b.fields.includes(name));
  const onlyB = b.fields.filter((name) => !a.fields.includes(name));
  if (onlyA.length > 0 || onlyB.length > 0) {
    const parts: string[] = [];
    if (onlyA.length > 0) parts.push(`только в A: ${onlyA.join(", ")}`);
    if (onlyB.length > 0) parts.push(`только в B: ${onlyB.join(", ")}`);
    return parts.join("; ");
  }
  return "—";
}

/** Строка таблицы «Данные»: прогон одной модели по одному сообщению. */
interface DataRunRow {
  message: Message;
  /** Опкод — байт смещения 2, null если кадр короче 3 байт. */
  opcode: number | null;
  statusA: string;
  statusB: string;
  fieldsA: string[];
  fieldsB: string[];
}

/** Область показа строк: всё / только расхождения / только совпадающие. */
type DataScope = "all" | "diff" | "same";

/** Ключ группы расхождения — классификация строки прогона. */
function classifyRow(row: DataRunRow): string {
  if (row.statusA !== row.statusB) {
    return `${row.statusA} → ${row.statusB}`;
  }
  // Статусы равны — расхождение только по набору полей.
  const setA = new Set(row.fieldsA);
  const setB = new Set(row.fieldsB);
  const fieldsSame =
    row.fieldsA.length === row.fieldsB.length &&
    row.fieldsA.every((name) => setB.has(name)) &&
    row.fieldsB.every((name) => setA.has(name));
  if (!fieldsSame) {
    return `${row.statusA} → ${row.statusB} (разные поля)`;
  }
  return "без изменений";
}

/** Строка принадлежит области «только расхождения» / «совпадающие». */
function rowInScope(row: DataRunRow, scope: DataScope): boolean {
  const same = classifyRow(row) === "без изменений";
  if (scope === "diff") return !same;
  if (scope === "same") return same;
  return true;
}

/** Порядок значимости групп: not-parsed → partial → совпадающие. */
function groupWeight(label: string): number {
  if (label.includes("not-parsed")) return 0;
  if (label.includes("partial")) return 1;
  return 2;
}

/** Одна группа строк одной классификации. */
interface DataGroup {
  label: string;
  rows: DataRunRow[];
}

/** Группировка строк: сортировка групп по значимости, внутри — по номеру. */
function groupRows(rows: DataRunRow[], scope: DataScope): DataGroup[] {
  const map = new Map<string, DataRunRow[]>();
  for (const row of rows) {
    if (!rowInScope(row, scope)) continue;
    const label = classifyRow(row);
    const list = map.get(label);
    if (list) list.push(row);
    else map.set(label, [row]);
  }

  return [...map.entries()]
    .map(([label, list]) => ({
      label,
      rows: [...list].sort(
        (a, b) => a.message.packetNumber - b.message.packetNumber,
      ),
    }))
    .sort((a, b) => {
      const weight = groupWeight(a.label) - groupWeight(b.label);
      if (weight !== 0) return weight;
      return a.label.localeCompare(b.label);
    });
}

function formatOpcodeByte(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** Описание изменения условия правила — было → стало. */
function formatConditionChange(
  before: ModelRule["condition"],
  after: ModelRule["condition"],
): string {
  const format = (condition: ModelRule["condition"]): string => {
    const parts: string[] = [];
    if (condition.opcode !== undefined) {
      parts.push(`opcode = ${formatOpcodeByte(condition.opcode)}`);
    }
    if (condition.opcodes !== undefined) {
      parts.push(
        `opcodes = [${condition.opcodes.map(formatOpcodeByte).join(", ")}]`,
      );
    }
    if (condition.lengthEquals !== undefined) {
      parts.push(`length = ${condition.lengthEquals}`);
    }
    if (condition.maxMessageLength !== undefined) {
      parts.push(`длина ≤ ${condition.maxMessageLength} Б`);
    }
    return parts.length > 0 ? parts.join(", ") : "всегда (fallback)";
  };
  return `${format(before)} → ${format(after)}`;
}

/** Строка дерева: изменение одного поля правила. */
function FieldDiffRow({ field }: { field: ModelFieldDiff }) {
  const parts: string[] = [];
  if (field.changes?.type) {
    parts.push(`type: ${field.changes.type.before} → ${field.changes.type.after}`);
  }
  if (field.changes?.offset) {
    parts.push(`offset: ${String(field.changes.offset.before)} → ${String(field.changes.offset.after)}`);
  }
  if (field.changes?.length) {
    parts.push(`length: ${String(field.changes.length.before)} → ${String(field.changes.length.after)}`);
  }
  if (field.changes?.note && (field.changes.note.before || field.changes.note.after)) {
    parts.push(`note: ${field.changes.note.before || "—"} → ${field.changes.note.after || "—"}`);
  }

  return (
    <div
      className={cn(
        "flex items-baseline gap-2 px-3 py-0.5",
        ROW_TONE[field.type],
      )}
    >
      <span
        className={cn(
          "w-4 shrink-0 text-center font-mono text-[10px]",
          MARK_TONE[field.type],
        )}
      >
        {MARK_GLYPH[field.type]}
      </span>
      <span className="min-w-0 shrink-0 font-mono text-[11px]">
        {field.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
        {parts.length > 0 ? parts.join(" · ") : "без изменений"}
      </span>
    </div>
  );
}

/** Строка дерева: одно правило с раскрытием полей. */
function RuleDiffRow({
  rule,
  open,
  onToggle,
}: {
  rule: ModelRuleDiff;
  open: boolean;
  onToggle: () => void;
}) {
  const glyph = MARK_GLYPH[rule.type];
  const typeLabel: Record<ModelRuleDiff["type"], string> = {
    added: "добавлено",
    removed: "удалено",
    changed: "изменено",
    unchanged: "без изменений",
  };

  const changeParts: string[] = [];
  if (rule.changes?.name) {
    changeParts.push(`имя: ${rule.changes.name.before} → ${rule.changes.name.after}`);
  }
  if (rule.changes?.condition) {
    const formatted = formatConditionChange(
      rule.changes.condition.before,
      rule.changes.condition.after,
    );
    if (formatted) changeParts.push(formatted);
  }

  const hasFields = (rule.fieldsDiff?.length ?? 0) > 0;

  return (
    <div className={cn("flex flex-col", ROW_TONE[rule.type])}>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-baseline gap-2 px-2 py-1 text-left transition-colors hover:bg-muted/60"
      >
        <span
          className={cn(
            "w-4 shrink-0 text-center font-mono text-[10px]",
            MARK_TONE[rule.type],
          )}
        >
          {glyph}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs">
          Правило: {rule.ruleName}
        </span>
        <span
          className={cn("shrink-0 text-[10px]", MARK_TONE[rule.type])}
        >
          {typeLabel[rule.type]}
        </span>
        {hasFields ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {open ? "▾" : "▸"}
          </span>
        ) : null}
      </button>
      {changeParts.length > 0 ? (
        <div className="px-8 pb-1 text-[11px] text-muted-foreground">
          {changeParts.join(" · ")}
        </div>
      ) : null}
      {open && hasFields ? (
        <div className="flex flex-col border-t border-border/40 pb-1">
          {(rule.fieldsDiff ?? []).map((field) => (
            <FieldDiffRow key={field.name} field={field} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Диалог сравнения двух моделей (R10.2).
 *
 * A — текущая активная модель редактора, B — выбор из остальных моделей.
 * Вкладка «Структура» — дерево diffModels; «Данные» — прогон обеих моделей
 * на записях проекта (первые 100 сообщений, кнопка «Прогнать все»).
 */
export function CompareModelsDialog({
  open,
  onClose,
  modelA,
}: {
  open: boolean;
  onClose: () => void;
  modelA: Model;
}) {
  const models = useAppStore((state) => state.models);
  const activeCaptureId = useAppStore((state) => state.activeCaptureId);
  const gotoMessage = useAppStore((state) => state.gotoMessage);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const [modelBId, setModelBId] = useState<string | null>(null);
  const [openRuleIds, setOpenRuleIds] = useState<Set<string>>(new Set());
  const [runRows, setRunRows] = useState<DataRunRow[] | null>(null);
  const [runProgress, setRunProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runTotal, setRunTotal] = useState<number>(0);
  const [dataScope, setDataScope] = useState<DataScope>("all");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const runToken = useRef(0);

  const otherModels = useMemo(
    () => (models ?? []).filter((item) => item.id !== modelA.id),
    [models, modelA.id],
  );

  const modelB = useMemo(
    () => otherModels.find((item) => item.id === modelBId) ?? null,
    [otherModels, modelBId],
  );

  // Первый «другой» модель по умолчанию.
  useEffect(() => {
    if (!open) return;
    setModelBId(otherModels[0]?.id ?? null);
    setOpenRuleIds(new Set());
    setRunRows(null);
    setRunError(null);
    setRunProgress(null);
    setDataScope("all");
    setGroupFilter(null);
  }, [open, otherModels]);

  // Открытый диалог забирает Esc — держим overlayOpen синхронно с `open`.
  useEffect(() => {
    setOverlayOpen(open);
  }, [open, setOverlayOpen]);

  const diff = useMemo<ModelDiffResult | null>(
    () => (modelB ? diffModels(modelA, modelB) : null),
    [modelA, modelB],
  );

  const toggleRule = useCallback((ruleId: string) => {
    setOpenRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }, []);

  /** Прогон: limit === null — все сообщения записи. */
  const runCompare = useCallback(
    async (limit: number | null) => {
      if (!activeCaptureId || !modelB) return;
      const token = ++runToken.current;
      setRunError(null);
      setRunRows([]);
      setRunProgress({ done: 0, total: 0 });
      setGroupFilter(null);

      try {
        const sessions = await appService.listSessions(activeCaptureId);
        const lists = await Promise.all(
          sessions.map((session) => appService.listMessages(session.id)),
        );
        const all = lists.flat();
        const slice = limit === null ? all : all.slice(0, limit);
        setRunTotal(all.length);
        setRunProgress({ done: 0, total: slice.length });

        const rows: DataRunRow[] = [];
        let done = 0;
        let next = 0;

        const worker = async () => {
          while (next < slice.length) {
            if (token !== runToken.current) return;
            const index = next;
            next += 1;
            const message = slice[index];
            const bytes = await appService.getBytes(
              activeCaptureId,
              message.byteOffset,
              message.length,
            );
            if (token !== runToken.current) return;
            const resultA = applyModelCached(message.id, bytes, modelA);
            const resultB = applyModelCached(message.id, bytes, modelB);
            rows.push({
              message,
              opcode: bytes.length > 2 ? bytes[2] : null,
              statusA: resultA.status,
              statusB: resultB.status,
              fieldsA: resultA.fields.map((field) => field.name),
              fieldsB: resultB.fields.map((field) => field.name),
            });
            done += 1;
            if (token === runToken.current) {
              setRunProgress({ done, total: slice.length });
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(8, Math.max(slice.length, 1)) }, () =>
            worker(),
          ),
        );
        if (token !== runToken.current) return;
        setRunRows(rows);
        setRunProgress(null);
      } catch (error) {
        if (token !== runToken.current) return;
        setRunProgress(null);
        setRunError(
          error instanceof Error ? error.message : "Сбой прогона",
        );
      }
    },
    [activeCaptureId, modelA, modelB],
  );

  // Закрытие: гасим незавершённый прогон.
  useEffect(() => {
    if (!open) runToken.current += 1;
  }, [open]);

  const handleGoto = useCallback(
    (messageId: string) => {
      onClose();
      void gotoMessage(messageId);
    },
    [onClose, gotoMessage],
  );

  // Счётчики и группы для вкладки «Данные».
  const { sameCount, diffCount, scopedGroups, groups, visibleCount } =
    useMemo(() => {
      if (!runRows || runRows.length === 0) {
        return {
          sameCount: 0,
          diffCount: 0,
          scopedGroups: [] as DataGroup[],
          groups: [] as DataGroup[],
          visibleCount: 0,
        };
      }
      let same = 0;
      for (const row of runRows) {
        if (classifyRow(row) === "без изменений") same += 1;
      }
      const scoped = groupRows(runRows, dataScope);
      const filtered =
        groupFilter === null
          ? scoped
          : scoped.filter((group) => group.label === groupFilter);
      const visible = filtered.reduce(
        (sum, group) => sum + group.rows.length,
        0,
      );
      return {
        sameCount: same,
        diffCount: runRows.length - same,
        scopedGroups: scoped,
        groups: filtered,
        visibleCount: visible,
      };
    }, [runRows, dataScope, groupFilter]);

  if (!open) return null;

  const othersEmpty = otherModels.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Сравнение моделей</DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            A: {modelA.name} ({MODEL_STATUS_LABEL[modelA.status]})
          </span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          {othersEmpty ? (
            <span className="text-muted-foreground">
              Нет других моделей для сравнения
            </span>
          ) : (
            <Select value={modelBId ?? ""} onValueChange={setModelBId}>
              <SelectTrigger className="h-7 w-auto min-w-40 text-xs">
                <SelectValue placeholder="Модель B" />
              </SelectTrigger>
              <SelectContent>
                {otherModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name} ({MODEL_STATUS_LABEL[model.status]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {othersEmpty ? null : !modelB || !diff ? (
          <p className="text-xs text-muted-foreground">
            Выберите модель B для сравнения.
          </p>
        ) : (
          <Tabs defaultValue="structure" className="flex min-h-0 flex-1 flex-col gap-2">
            <TabsList variant="line" className="shrink-0">
              <TabsTrigger value="structure" className="text-xs">
                Структура
              </TabsTrigger>
              <TabsTrigger value="data" className="text-xs">
                Данные
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="structure"
              className="flex min-h-0 flex-1 flex-col gap-2"
            >
              <div className="shrink-0 text-[11px] text-muted-foreground">
                Правил: {modelA.rules.length} → {modelB.rules.length} (+
                {diff.summary.added}, −{diff.summary.removed}, Δ
                {diff.summary.changed}, ={diff.summary.unchanged})
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border/60">
                <div className="flex flex-col divide-y divide-border/40">
                  {diff.rules.map((rule) => (
                    <RuleDiffRow
                      key={`${rule.type}-${rule.ruleId}`}
                      rule={rule}
                      open={openRuleIds.has(rule.ruleId)}
                      onToggle={() => toggleRule(rule.ruleId)}
                    />
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent
              value="data"
              className="flex min-h-0 flex-1 flex-col gap-2"
            >
              {!activeCaptureId ? (
                <p className="text-xs text-muted-foreground">
                  Загрузите запись
                </p>
              ) : (
                <>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={runProgress !== null}
                      onClick={() => void runCompare(DEFAULT_LIMIT)}
                    >
                      <Play className="size-3.5" />
                      Прогнать (первые {DEFAULT_LIMIT})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={runProgress !== null}
                      onClick={() => void runCompare(null)}
                    >
                      Прогнать все
                    </Button>
                    {runProgress !== null ? (
                      <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        {runProgress.done} / {runProgress.total}
                      </span>
                    ) : null}
                    {runRows && runRows.length > 0 ? (
                      <span className="text-[11px] text-muted-foreground">
                        {visibleCount !== runRows.length
                          ? `Показано ${visibleCount} из ${runRows.length}`
                          : `Показано ${runRows.length} из ${runTotal}`}
                      </span>
                    ) : null}
                  </div>
                  {runError ? (
                    <p className="text-xs text-destructive">{runError}</p>
                  ) : null}
                  {runRows && runRows.length > 0 ? (
                    <>
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {(
                          [
                            ["all", `Все (${runRows.length})`],
                            ["diff", `Только расхождения (${diffCount})`],
                            ["same", `Совпадающие (${sameCount})`],
                          ] as Array<[DataScope, string]>
                        ).map(([scope, label]) => (
                          <button
                            key={scope}
                            type="button"
                            disabled={scope === "same" && sameCount === 0}
                            onClick={() => {
                              setDataScope(scope);
                              setGroupFilter(null);
                            }}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                              dataScope === scope
                                ? "border-foreground/30 bg-muted font-medium text-foreground"
                                : "border-border/60 text-muted-foreground hover:bg-muted/60",
                              scope === "same" &&
                                sameCount === 0 &&
                                "cursor-default opacity-50",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        {scopedGroups.map((group) => {
                          const active = groupFilter === group.label;
                          return (
                            <button
                              key={group.label}
                              type="button"
                              title={
                                active
                                  ? "Показать все группы"
                                  : "Показать только эту группу"
                              }
                              onClick={() =>
                                setGroupFilter(active ? null : group.label)
                              }
                              className={cn(
                                "rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
                                active
                                  ? "border-foreground/30 bg-muted font-medium text-foreground"
                                  : "border-border/60 text-muted-foreground hover:bg-muted/60",
                              )}
                            >
                              {group.label} ({group.rows.length})
                            </button>
                          );
                        })}
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border/60">
                        <div className="flex flex-col font-mono text-[11px]">
                          <div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-popover px-2 py-1 font-sans text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                            <span className="w-10 shrink-0">№</span>
                            <span className="min-w-0 flex-1">Сообщение</span>
                            <span className="w-16 shrink-0">A</span>
                            <span className="w-16 shrink-0">B</span>
                            <span className="min-w-0 flex-1 text-right">
                              Расхождение
                            </span>
                          </div>
                          {groups.map((group) => (
                            <div key={group.label} className="flex flex-col">
                              <div className="sticky top-[25px] z-10 flex items-center gap-2 border-b border-t bg-muted px-2 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">
                                {group.label} ({group.rows.length})
                              </div>
                              {group.rows.map((row) => {
                                const diffText = describeDataDiff(
                                  {
                                    status: row.statusA,
                                    fields: row.fieldsA,
                                  },
                                  {
                                    status: row.statusB,
                                    fields: row.fieldsB,
                                  },
                                );
                                const hasDiff = diffText !== "—";
                                return (
                                  <button
                                    key={row.message.id}
                                    type="button"
                                    title="Перейти к сообщению"
                                    onClick={() => handleGoto(row.message.id)}
                                    className={cn(
                                      "flex items-center gap-2 px-2 py-0.5 text-left transition-colors hover:bg-muted",
                                      hasDiff && "bg-diff/10",
                                    )}
                                  >
                                    <span className="w-10 shrink-0">
                                      #{row.message.packetNumber}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">
                                      {row.opcode !== null
                                        ? formatOpcodeByte(row.opcode)
                                        : "—"}
                                    </span>
                                    <span
                                      className={cn(
                                        "w-16 shrink-0",
                                        row.statusA === "not-parsed" &&
                                          "text-destructive",
                                        row.statusA === "parsed" && "text-ok",
                                      )}
                                    >
                                      {row.statusA}
                                    </span>
                                    <span
                                      className={cn(
                                        "w-16 shrink-0",
                                        row.statusB === "not-parsed" &&
                                          "text-destructive",
                                        row.statusB === "parsed" && "text-ok",
                                      )}
                                    >
                                      {row.statusB}
                                    </span>
                                    <span
                                      className={cn(
                                        "min-w-0 flex-1 truncate text-right font-sans",
                                        hasDiff
                                          ? "text-warn"
                                          : "text-muted-foreground",
                                      )}
                                    >
                                      {diffText}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                          {visibleCount === 0 ? (
                            <p className="px-2 py-3 text-center font-sans text-xs text-muted-foreground">
                              Нет строк в выбранном фильтре.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : runRows && runRows.length === 0 && runProgress === null ? (
                    <p className="text-xs text-muted-foreground">
                      Сообщений нет — нажмите «Прогнать».
                    </p>
                  ) : null}
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
