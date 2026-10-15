"use client";

import { useEffect } from "react";
import { FlaskConical } from "lucide-react";
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
import type { InferEvidenceRule } from "@/src/types/domain";

function EvidenceRow({ rule }: { rule: InferEvidenceRule }) {
  return (
    <li className="rounded border border-border/60 px-2 py-1.5">
      <span className="block font-mono text-xs font-medium">
        {rule.opcode === null
          ? `длина ${rule.msg_len}`
          : `opcode 0x${rule.opcode.toString(16).toUpperCase().padStart(2, "0")} · длина ${rule.msg_len}`}
      </span>
      <span className="block text-[11px] text-muted-foreground">
        сэмплов {rule.samples} · размечено {rule.labeled}
      </span>
      {rule.fields.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {rule.fields.map((field) => (
            <li
              key={field.name}
              className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
            >
              <span>
                {field.name} <span className="text-muted-foreground">{field.type}[{field.offset}]</span>
              </span>
              <span className="shrink-0 text-ok">
                {field.matches}/{field.total}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="block text-[11px] text-warn">
          уверенных полей нет
        </span>
      )}
    </li>
  );
}

/**
 * Диалог автовывода модели: показывает кластеры и evidence совпадений
 * (смещение, тип, matches/total). Ничего не создаёт без согласия.
 */
export function InferDialog() {
  const result = useAppStore((state) => state.inferResult);
  const accept = useAppStore((state) => state.acceptInferModel);
  const dismiss = useAppStore((state) => state.dismissInferModel);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const open = result !== null;

  useEffect(() => {
    setOverlayOpen(open);
  }, [open, setOverlayOpen]);

  if (!result) return null;

  const canCreate = result.model.rules.length > 0;
  const withFields = result.evidence.filter((rule) => rule.fields.length > 0).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <FlaskConical className="size-4" aria-hidden="true" />
            Выведенная модель
          </DialogTitle>
          <DialogDescription>
            Дифф сообщений с разными параметрами журнала: {result.samples}{" "}
            сэмплов, размечено {result.labeled}, кластеров {result.clusters}.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {result.evidence.map((rule) => (
            <EvidenceRow key={rule.rule_id} rule={rule} />
          ))}
        </ul>

        <p
          className={cn(
            "text-[11px]",
            canCreate ? "text-muted-foreground" : "text-warn",
          )}
        >
          {canCreate
            ? `Будет создана модель «${result.model.name}» (${withFields} правил с полями из ${result.evidence.length}).`
            : "Кластеры есть, но уверенных полей нет — создавать нечего."}
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={dismiss}>
            Не сейчас
          </Button>
          <Button size="sm" disabled={!canCreate} onClick={() => void accept()}>
            Создать модель
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
