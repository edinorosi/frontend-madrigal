"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  Download,
  Pencil,
  Play,
  Plus,
  Radar,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/src/lib/keyboard";
import {
  HexContextMenu,
  type HexContextMenuItem,
} from "@/components/hex/hex-context-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { createId } from "@/src/lib/ids";
import { downloadJson } from "@/src/lib/export/download";
import {
  buildRuleExport,
  parseRuleExport,
  ruleFileName,
} from "@/src/lib/export/rule-export";
import {
  MODEL_STATUS_LABEL,
  MODEL_STATUS_TONE,
} from "@/src/lib/model-status";
import { useAppStore } from "@/src/store/app";
import type { Model, ModelRule, ModelStatus } from "@/src/types/domain";
import { RuleForm } from "@/components/model/rule-form";
import { CompareModelsDialog } from "@/components/model/compare-models-dialog";

function formatOpcode(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function describeCondition(condition: ModelRule["condition"]): string {
  const parts: string[] = [];
  if (condition.opcode !== undefined) {
    parts.push(`opcode = ${formatOpcode(condition.opcode)}`);
  }
  if (condition.opcodes !== undefined) {
    parts.push(`opcodes = [${condition.opcodes.map(formatOpcode).join(", ")}]`);
  }
  if (condition.lengthEquals !== undefined) {
    parts.push(`length = ${condition.lengthEquals}`);
  }
  if (condition.maxMessageLength !== undefined) {
    parts.push(`длина ≤ ${condition.maxMessageLength} Б`);
  }
  return parts.length > 0 ? parts.join(", ") : "всегда (fallback)";
}

/** Тип элемента, по которому открылось ПКМ редактора. */
type MenuTarget =
  | { kind: "model"; modelId: string }
  | { kind: "rule"; ruleId: string };

type MenuState = MenuTarget & {
  x: number;
  y: number;
  w: number;
  h: number;
};

function ModelStatusDropdown({
  model,
  onChange,
}: {
  model: Model;
  onChange: (status: ModelStatus) => void;
}) {
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  return (
    <DropdownMenu onOpenChange={setOverlayOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded" title="Статус модели">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 px-1.5 text-[11px] font-normal",
              MODEL_STATUS_TONE[model.status],
            )}
          >
            {MODEL_STATUS_LABEL[model.status]}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        {(Object.keys(MODEL_STATUS_LABEL) as ModelStatus[]).map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={model.status === status}
            onCheckedChange={() => onChange(status)}
          >
            {MODEL_STATUS_LABEL[status]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ModelEditor() {
  const closeModelEditor = useAppStore((state) => state.closeModelEditor);
  const overlayOpen = useAppStore((state) => state.overlayOpen);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);
  const models = useAppStore((state) => state.models);
  const modelsLoading = useAppStore((state) => state.modelsLoading);
  const activeModelId = useAppStore((state) => state.activeModelId);
  const setActiveModel = useAppStore((state) => state.setActiveModel);
  const saveModel = useAppStore((state) => state.saveModel);
  const removeModel = useAppStore((state) => state.removeModel);
  const applyCapture = useAppStore((state) => state.applyCapture);
  const cancelApply = useAppStore((state) => state.cancelApply);
  const analyzePatterns = useAppStore((state) => state.analyzePatterns);
  const patternLoading = useAppStore((state) => state.patternLoading);
  const applyCaptureProgress = useAppStore(
    (state) => state.applyCaptureProgress,
  );
  const applyCaptureSummary = useAppStore(
    (state) => state.applyCaptureSummary,
  );
  const applyCaptureError = useAppStore((state) => state.applyCaptureError);

  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingModelId, setRenamingModelId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeModel = useMemo(
    () => models?.find((item) => item.id === activeModelId) ?? null,
    [models, activeModelId],
  );

  const selectedRule = useMemo(() => {
    if (!activeModel) return null;
    return (
      activeModel.rules.find((item) => item.id === selectedRuleId) ??
      activeModel.rules[0] ??
      null
    );
  }, [activeModel, selectedRuleId]);

  // Esc закрывает сначала ПКМ, затем редактор; Radix-меню держат overlayOpen.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc из поля ввода завершает ввод, а не закрывает редактор.
      if (isTypingTarget(event.target)) return;
      if (menu) {
        setMenu(null);
        setOverlayOpen(false);
        return;
      }
      if (overlayOpen) return;
      closeModelEditor();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen, menu, closeModelEditor, setOverlayOpen]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setOverlayOpen(false);
  }, [setOverlayOpen]);

  const openMenu = useCallback(
    (target: MenuTarget, event: React.MouseEvent) => {
      event.preventDefault();
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenu({
        ...target,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        w: rect.width,
        h: rect.height,
      });
      setOverlayOpen(true);
    },
    [setOverlayOpen],
  );

  const handleSelectModel = useCallback(
    (modelId: string) => {
      setActiveModel(modelId);
      setSelectedRuleId(null);
    },
    [setActiveModel],
  );

  const handleCreateModel = useCallback(async () => {
    const model: Model = {
      id: createId("model"),
      name: "Новая модель",
      status: "draft",
      rules: [],
      createdAt: new Date().toISOString(),
    };
    await saveModel(model);
    setActiveModel(model.id);
    setSelectedRuleId(null);
  }, [saveModel, setActiveModel]);

  // Удаление необратимо — спрашиваем: и кнопка, и пункт меню ведут сюда.
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "model" | "rule"; id: string } | null
  >(null);

  const handleDeleteModel = useCallback(
    async (modelId: string) => {
      setPendingDelete({ kind: "model", id: modelId });
    },
    [],
  );

  const confirmPendingDelete = useCallback(async () => {
    const pending = pendingDelete;
    setPendingDelete(null);
    if (!pending) return;

    if (pending.kind === "model") {
      await removeModel(pending.id);
      return;
    }
    if (!activeModel) return;
    const next = activeModel.rules.filter((item) => item.id !== pending.id);
    await saveModel({ ...activeModel, rules: next });
    setSelectedRuleId((current) =>
      current === pending.id ? (next[0]?.id ?? null) : current,
    );
  }, [pendingDelete, activeModel, removeModel, saveModel]);

  const handleDuplicateModel = useCallback(
    async (modelId: string) => {
      const source = models?.find((item) => item.id === modelId);
      if (!source) return;
      const copy: Model = {
        ...source,
        id: createId("model"),
        name: `${source.name} (копия)`,
        status: "draft",
        rules: source.rules.map((rule) => ({
          ...rule,
          id: createId("rule"),
          condition: { ...rule.condition },
          fields: rule.fields.map((field) => ({ ...field })),
        })),
        createdAt: new Date().toISOString(),
      };
      await saveModel(copy);
    },
    [models, saveModel],
  );

  const handleRenameModel = useCallback(async () => {
    if (renamingModelId === null) return;
    const source = models?.find((item) => item.id === renamingModelId);
    setRenamingModelId(null);
    if (!source) return;
    const name = renameText.trim();
    if (!name || name === source.name) return;
    await saveModel({ ...source, name });
  }, [renamingModelId, renameText, models, saveModel]);

  const handleCreateRule = useCallback(async () => {
    if (!activeModel) return;
    const rule: ModelRule = {
      id: createId("rule"),
      name: "Новое правило",
      condition: {},
      fields: [],
    };
    await saveModel({ ...activeModel, rules: [...activeModel.rules, rule] });
    setSelectedRuleId(rule.id);
  }, [activeModel, saveModel]);

  /* ── Обмен правилами: экспорт одного правила, импорт в активную модель ── */

  const [ruleNotice, setRuleNotice] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const ruleNoticeTimerRef = useRef<number | null>(null);
  const ruleImportInputRef = useRef<HTMLInputElement>(null);

  const showRuleNotice = useCallback((text: string, isError: boolean) => {
    setRuleNotice({ text, isError });
    if (ruleNoticeTimerRef.current !== null) {
      window.clearTimeout(ruleNoticeTimerRef.current);
    }
    ruleNoticeTimerRef.current = window.setTimeout(
      () => setRuleNotice(null),
      3000,
    );
  }, []);

  useEffect(
    () => () => {
      if (ruleNoticeTimerRef.current !== null) {
        window.clearTimeout(ruleNoticeTimerRef.current);
      }
    },
    [],
  );

  const handleExportRule = useCallback(
    (ruleId: string) => {
      if (!activeModel) return;
      const rule = activeModel.rules.find((item) => item.id === ruleId);
      if (!rule) return;
      downloadJson(
        ruleFileName(rule),
        buildRuleExport(rule, {
          id: activeModel.id,
          name: activeModel.name,
        }),
      );
    },
    [activeModel],
  );

  const handleImportRuleFile = useCallback(
    async (file: File) => {
      if (!activeModel) return;
      try {
        const rule = parseRuleExport(await file.text());
        await saveModel({
          ...activeModel,
          rules: [...activeModel.rules, rule],
        });
        showRuleNotice(`Правило «${rule.name}» добавлено`, false);
      } catch (error) {
        showRuleNotice(
          error instanceof Error
            ? error.message
            : "Не удалось импортировать правило",
          true,
        );
      }
    },
    [activeModel, saveModel, showRuleNotice],
  );

  const handleDeleteRule = useCallback(
    async (ruleId: string) => {
      setPendingDelete({ kind: "rule", id: ruleId });
    },
    [],
  );

  const handleDuplicateRule = useCallback(
    async (ruleId: string) => {
      if (!activeModel) return;
      const index = activeModel.rules.findIndex((item) => item.id === ruleId);
      if (index < 0) return;
      const source = activeModel.rules[index];
      const copy: ModelRule = {
        ...source,
        id: createId("rule"),
        name: `${source.name} (копия)`,
        condition: { ...source.condition },
        fields: source.fields.map((field) => ({ ...field })),
      };
      const next = [...activeModel.rules];
      next.splice(index + 1, 0, copy);
      await saveModel({ ...activeModel, rules: next });
    },
    [activeModel, saveModel],
  );

  const handleMoveRule = useCallback(
    async (ruleId: string, delta: -1 | 1) => {
      if (!activeModel) return;
      const index = activeModel.rules.findIndex((item) => item.id === ruleId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= activeModel.rules.length) return;
      const next = [...activeModel.rules];
      [next[index], next[target]] = [next[target], next[index]];
      await saveModel({ ...activeModel, rules: next });
    },
    [activeModel, saveModel],
  );

  const handleCommitRule = useCallback(
    (updated: ModelRule) => {
      if (!activeModel) return;
      void saveModel({
        ...activeModel,
        rules: activeModel.rules.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      });
    },
    [activeModel, saveModel],
  );

  const handleChangeStatus = useCallback(
    async (status: ModelStatus) => {
      if (!activeModel) return;
      await saveModel({ ...activeModel, status });
    },
    [activeModel, saveModel],
  );

  const menuItems = useMemo<HexContextMenuItem[]>(() => {
    if (!menu) return [];
    const items: HexContextMenuItem[] = [];

    if (menu.kind === "model") {
      const model = models?.find((item) => item.id === menu.modelId);
      if (!model) return [];
      if (model.id !== activeModelId) {
        items.push({
          id: "activate",
          label: "Сделать активной",
          icon: Check,
          onSelect: () => {
            closeMenu();
            handleSelectModel(model.id);
          },
        });
      }
      items.push({
        id: "rename",
        label: "Переименовать",
        icon: Pencil,
        onSelect: () => {
          closeMenu();
          setRenameText(model.name);
          setRenamingModelId(model.id);
        },
      });
      items.push({
        id: "duplicate",
        label: "Дублировать",
        icon: Copy,
        onSelect: () => {
          closeMenu();
          void handleDuplicateModel(model.id);
        },
      });
      items.push({
        id: "delete",
        label: "Удалить",
        icon: Trash2,
        separatorBefore: true,
        onSelect: () => {
          closeMenu();
          void handleDeleteModel(model.id);
        },
      });
      return items;
    }

    if (!activeModel) return [];
    const index = activeModel.rules.findIndex(
      (item) => item.id === menu.ruleId,
    );
    if (index < 0) return [];
    items.push({
      id: "duplicate",
      label: "Дублировать",
      icon: Copy,
      onSelect: () => {
        closeMenu();
        void handleDuplicateRule(menu.ruleId);
      },
    });
    items.push({
      id: "export",
      label: "Экспорт правила (JSON)",
      icon: Download,
      onSelect: () => {
        closeMenu();
        handleExportRule(menu.ruleId);
      },
    });
    if (index > 0) {
      items.push({
        id: "up",
        label: "Переместить вверх",
        icon: ArrowUp,
        onSelect: () => {
          closeMenu();
          void handleMoveRule(menu.ruleId, -1);
        },
      });
    }
    if (index < activeModel.rules.length - 1) {
      items.push({
        id: "down",
        label: "Переместить вниз",
        icon: ArrowDown,
        onSelect: () => {
          closeMenu();
          void handleMoveRule(menu.ruleId, 1);
        },
      });
    }
    items.push({
      id: "delete",
      label: "Удалить",
      icon: Trash2,
      separatorBefore: true,
      onSelect: () => {
        closeMenu();
        void handleDeleteRule(menu.ruleId);
      },
    });
    return items;
  }, [
    menu,
    models,
    activeModelId,
    activeModel,
    closeMenu,
    handleSelectModel,
    handleDuplicateModel,
    handleDeleteModel,
    handleDuplicateRule,
    handleMoveRule,
    handleDeleteRule,
    handleExportRule,
  ]);

  // Текст подтверждения удаления: имя объекта, если оно ещё известно.
  const deleteConfirm = (() => {
    const pending = pendingDelete;
    if (pending === null) return null;
    if (pending.kind === "rule") {
      const name =
        activeModel?.rules.find((item) => item.id === pending.id)?.name ?? "";
      return {
        title: "Удалить правило?",
        description: name
          ? `Правило «${name}» будет удалено из модели.`
          : "Правило будет удалено из модели.",
      };
    }
    const name = models?.find((item) => item.id === pending.id)?.name ?? "";
    return {
      title: "Удалить модель?",
      description: name
        ? `Модель «${name}» будет удалена.`
        : "Модель будет удалена.",
    };
  })();

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2"
          onClick={closeModelEditor}
        >
          <ArrowLeft className="size-3.5" />
          Назад
        </Button>
        <span className="text-sm font-medium">Редактор модели</span>
        {activeModel ? (
          <>
            <span className="text-sm text-muted-foreground">
              {activeModel.name}
            </span>
            <ModelStatusDropdown
              model={activeModel}
              onChange={(status) => void handleChangeStatus(status)}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2"
              disabled={(models?.length ?? 0) < 2}
              title="Сравнить текущую модель с другой"
              onClick={() => setCompareOpen(true)}
            >
              <ArrowRight className="size-3.5" />
              Сравнить с…
            </Button>
          </>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {ruleNotice ? (
            <span
              role="status"
              className={cn(
                "text-[11px]",
                ruleNotice.isError ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {ruleNotice.text}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2"
            disabled={patternLoading}
            title="Просканировать байты активной записи и предложить модель"
            onClick={() => {
              void analyzePatterns().then((found) => {
                if (!found) showRuleNotice("Паттерны не обнаружены", false);
              });
            }}
          >
            <Radar className="size-3.5" />
            Распознать паттерны
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2"
            disabled={!activeModel}
            title="Добавить правило из JSON-файла в активную модель"
            onClick={() => ruleImportInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            Импорт правила
          </Button>
          <input
            ref={ruleImportInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Сброс нужен, чтобы тот же файл можно было выбрать повторно.
              event.target.value = "";
              if (file) void handleImportRuleFile(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2"
            disabled={!activeModel || applyCaptureProgress !== null}
            title="Пересчитать поля всех сообщений записи этой моделью"
            onClick={() => void applyCapture()}
          >
            <Play className="size-3.5" />
            Применить к записи
          </Button>
        </div>
      </div>

      {applyCaptureProgress !== null || applyCaptureSummary !== null || applyCaptureError !== null ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted/30 px-3 py-1 font-mono text-[11px] text-muted-foreground">
          {applyCaptureProgress !== null ? (
            <>
              <span>
                Применение… {applyCaptureProgress.done} из{" "}
                {applyCaptureProgress.total}
              </span>
              <div
                role="progressbar"
                aria-label="Прогресс применения модели"
                aria-valuemin={0}
                aria-valuemax={applyCaptureProgress.total}
                aria-valuenow={applyCaptureProgress.done}
                className="h-1.5 min-w-24 w-40 overflow-hidden rounded-full bg-border"
              >
                <div
                  className="h-full bg-primary transition-[width] duration-100"
                  style={{
                    width: `${
                      applyCaptureProgress.total > 0
                        ? (applyCaptureProgress.done /
                            applyCaptureProgress.total) *
                          100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[11px]"
                onClick={cancelApply}
              >
                Отменить
              </Button>
            </>
          ) : null}
          {applyCaptureSummary !== null ? (
            <span>
              Применено к {applyCaptureSummary.total}: разобрано{" "}
              <span className="text-ok">{applyCaptureSummary.parsed}</span>, частично{" "}
              <span className="text-warn">{applyCaptureSummary.partial}</span>,
              не разобрано{" "}
              <span
                className={
                  applyCaptureSummary.notParsed > 0
                    ? "text-destructive"
                    : undefined
                }
              >
                {applyCaptureSummary.notParsed}
              </span>
            </span>
          ) : null}
          {applyCaptureError !== null ? (
            <span className="text-destructive">{applyCaptureError}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r">
          <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
            <span className="text-xs font-medium text-muted-foreground">
              Модели
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px]"
              onClick={() => void handleCreateModel()}
            >
              <Plus className="size-3" />
              Создать
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {modelsLoading && models === null ? (
              <div className="flex flex-col gap-1 p-2">
                <Skeleton className="h-7" />
                <Skeleton className="h-7" />
              </div>
            ) : null}
            {!modelsLoading && (models === null || models.length === 0) ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Моделей нет — создайте первую.
              </p>
            ) : null}
            {models?.map((model) => {
              const isActive = model.id === activeModelId;
              const isRenaming = renamingModelId === model.id;
              return (
                <div
                  key={model.id}
                  className={cn(
                    "group flex items-center gap-2 px-2 py-1",
                    isActive ? "bg-muted" : "hover:bg-muted/50",
                  )}
                  onContextMenu={(event) =>
                    openMenu({ kind: "model", modelId: model.id }, event)
                  }
                >
                  {isRenaming ? (
                    <Input
                      autoFocus
                      value={renameText}
                      onChange={(event) => setRenameText(event.target.value)}
                      onBlur={() => void handleRenameModel()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setRenamingModelId(null);
                      }}
                      className="h-6 flex-1 text-xs"
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => handleSelectModel(model.id)}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          isActive ? "bg-primary" : "bg-border",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {model.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "px-1.5 text-[11px] font-normal",
                          MODEL_STATUS_TONE[model.status],
                        )}
                      >
                        {MODEL_STATUS_LABEL[model.status]}
                      </Badge>
                    </button>
                  )}
                  {!isRenaming ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      title="Удалить модель"
                      onClick={() => void handleDeleteModel(model.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </ScrollArea>
        </aside>

        <section className="flex w-80 shrink-0 flex-col border-r">
          <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
            <span className="text-xs font-medium text-muted-foreground">
              Правила
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px]"
              disabled={!activeModel}
              onClick={() => void handleCreateRule()}
            >
              <Plus className="size-3" />
              Создать правило
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {!activeModel ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Модель не выбрана — выберите или создайте слева.
              </p>
            ) : null}
            {activeModel && activeModel.rules.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Правил нет — создайте первое.
              </p>
            ) : null}
            {activeModel?.rules.map((rule, index) => {
              const isSelected = rule.id === selectedRule?.id;
              return (
                <div
                  key={rule.id}
                  className={cn(
                    "group flex items-center gap-1 px-2 py-1",
                    isSelected ? "bg-muted" : "hover:bg-muted/50",
                  )}
                  onContextMenu={(event) =>
                    openMenu({ kind: "rule", ruleId: rule.id }, event)
                  }
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    onClick={() => setSelectedRuleId(rule.id)}
                  >
                    <span className="w-4 shrink-0 pt-0.5 text-right font-mono text-[10px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {rule.name}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {describeCondition(rule.condition)}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    title="Экспорт правила (JSON)"
                    onClick={() => handleExportRule(rule.id)}
                  >
                    <Download className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    title="Удалить правило"
                    onClick={() => void handleDeleteRule(rule.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              );
            })}
          </ScrollArea>
        </section>

        <section className="flex min-w-0 flex-1 flex-col">
          {selectedRule && activeModel ? (
            <RuleForm
              key={selectedRule.id}
              model={activeModel}
              rule={selectedRule}
              onCommit={handleCommitRule}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-3">
              <p className="text-sm text-muted-foreground">
                {activeModel && activeModel.rules.length === 0
                  ? "Правил нет — создайте первое."
                  : "Выберите правило для просмотра."}
              </p>
            </div>
          )}
        </section>
      </div>

      {menu ? (
        <HexContextMenu
          position={{ x: menu.x, y: menu.y }}
          containerWidth={menu.w}
          containerHeight={menu.h}
          items={menuItems}
          notice={null}
          onClose={closeMenu}
        />
      ) : null}

      <ConfirmDialog
        open={deleteConfirm !== null}
        title={deleteConfirm?.title ?? "Удалить?"}
        description={deleteConfirm?.description}
        onConfirm={() => void confirmPendingDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      {activeModel ? (
        <CompareModelsDialog
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          modelA={activeModel}
        />
      ) : null}
    </div>
  );
}
