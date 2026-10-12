"use client";

import { useEffect } from "react";
import {
  Binary,
  Braces,
  Hash,
  ListOrdered,
  Ruler,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/src/store/app";
import type { PatternFinding, PatternKind } from "@/src/lib/patterns";

const KIND_ICON: Record<PatternKind, typeof Binary> = {
  sync: Braces,
  opcode: ListOrdered,
  length: Ruler,
  tail: Hash,
  text: Binary,
};

const KIND_LABEL: Record<PatternKind, string> = {
  sync: "синхрослово",
  opcode: "опкоды",
  length: "длина",
  tail: "хвост",
  text: "текст",
};

function FindingRow({ finding }: { finding: PatternFinding }) {
  const Icon = KIND_ICON[finding.kind];

  return (
    <li className="flex items-start gap-2 rounded border border-border/60 px-2 py-1.5">
      <span
        className="mt-0.5 shrink-0 text-muted-foreground"
        title={KIND_LABEL[finding.kind]}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">{finding.title}</span>
        <span className="block text-[11px] text-muted-foreground">
          {finding.detail}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {Math.round(finding.confidence * 100)}%
      </span>
    </li>
  );
}

/**
 * Диалог предложения паттернов: показывается после импорта записи
 * (или по кнопке «Распознать паттерны»), когда эвристики нашли
 * закономерности. Ничего не создаёт без согласия пользователя.
 */
export function PatternDialog() {
  const suggestion = useAppStore((state) => state.patternSuggestion);
  const accept = useAppStore((state) => state.acceptPatternSuggestion);
  const dismiss = useAppStore((state) => state.dismissPatternSuggestion);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const open = suggestion !== null;

  // Открытый диалог забирает Esc — держим overlayOpen синхронно.
  useEffect(() => {
    setOverlayOpen(open);
  }, [open, setOverlayOpen]);

  if (!suggestion) return null;

  const canCreate = suggestion.model !== null;
  const sorted = [...suggestion.findings].sort(
    (a, b) => b.confidence - a.confidence,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Обнаружены паттерны</DialogTitle>
          <DialogDescription>
            По байтам сообщений найдены повторяющиеся закономерности.
            Можно сразу создать черновик модели — или отклонить.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {sorted.map((finding) => (
            <FindingRow key={`${finding.kind}-${finding.title}`} finding={finding} />
          ))}
        </ul>

        <p
          className={cn(
            "text-[11px]",
            canCreate ? "text-muted-foreground" : "text-warn",
          )}
        >
          {canCreate && suggestion.model
            ? `Будет создана модель «${suggestion.model.name}» — правила можно будет допилить в редакторе.`
            : "Недостаточно данных для модели — показаны только находки."}
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={dismiss}>
            Не сейчас
          </Button>
          <Button
            size="sm"
            disabled={!canCreate}
            onClick={() => void accept()}
          >
            Создать модель
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
