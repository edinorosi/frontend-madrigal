"use client";

import { Download, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatDate, formatBytes } from "@/src/lib/format";
import type { ProjectMeta } from "@/src/lib/projects";

/**
 * Русские числительные: 1 сессия, 2 сессии, 5 сессий.
 * Отдельного помощника в проекте нет, а писать «3 сессий» — дефект.
 */
function pluralRu(
  value: number,
  forms: [one: string, few: string, many: string],
): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }
  return forms[2];
}

function sessionLabel(count: number): string {
  return `${count} ${pluralRu(count, ["сессия", "сессии", "сессий"])}`;
}

function messageLabel(count: number): string {
  return `${count} ${pluralRu(count, ["сообщение", "сообщения", "сообщений"])}`;
}

/**
 * Карточка проекта в списке. Клик по карточке открывает проект; кнопки
 * внизу — те же действия, только адресные. Внутренние кнопки гасят
 * всплытие, чтобы клик по ним не открывал проект дважды.
 */
export function ProjectCard({
  project,
  disabled = false,
  onOpen,
  onExport,
  onDelete,
}: {
  project: ProjectMeta;
  disabled?: boolean;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { meta } = project;

  return (
    <article
      className={cn(
        "flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-4 transition-colors",
        "hover:border-primary/40 hover:bg-accent/40",
        disabled && "pointer-events-none opacity-60",
      )}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 truncate text-sm font-medium" title={project.name}>
          {project.name}
        </h2>
        <span
          className="shrink-0 font-mono text-[11px] text-muted-foreground"
          title={`Обновлён ${project.updatedAt}`}
        >
          {formatDate(project.updatedAt)}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <span
          className="truncate font-mono text-xs text-muted-foreground"
          title={meta.fileName ?? "Запись не загружена"}
        >
          {meta.fileName ?? "Запись не загружена"}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatBytes(meta.sizeBytes)} · {sessionLabel(meta.sessionCount)} ·{" "}
          {messageLabel(meta.messageCount)}
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Button
          size="sm"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          Открыть
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onExport();
          }}
        >
          <Download className="size-3.5" />
          Экспорт
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground hover:text-destructive"
          title="Удалить проект"
          aria-label={`Удалить проект ${project.name}`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </article>
  );
}
