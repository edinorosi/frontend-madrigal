"use client";

import { Crosshair, FileSearch, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ReferenceKind = "bytes" | "packet" | "observation";

const ICONS = {
  bytes: Crosshair,
  packet: FileSearch,
  observation: MessageSquare,
} as const;

/**
 * Сквозной паттерн «ссылка на источник» (§7).
 * Клик — переход к источнику (для байтов: выделение и прокрутка в HEX).
 * Наведение — превью того, куда ведёт ссылка.
 */
export function ReferenceChip({
  kind,
  label,
  preview,
  onSelect,
  className,
}: {
  kind: ReferenceKind;
  label: string;
  preview: string;
  onSelect?: () => void;
  className?: string;
}) {
  const Icon = ICONS[kind];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded border border-border",
            "bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] leading-none",
            "text-muted-foreground transition-colors",
            "hover:border-ring hover:bg-muted hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            className,
          )}
        >
          <Icon className="size-3" />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{preview}</TooltipContent>
    </Tooltip>
  );
}
