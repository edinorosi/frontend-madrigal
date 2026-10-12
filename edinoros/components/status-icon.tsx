import { CircleHelp, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParseStatus } from "@/src/types/domain";

const STATUS = {
  parsed: { Icon: Check, tone: "text-ok", title: "Разобрано" },
  unknown: { Icon: CircleHelp, tone: "text-warn", title: "Неизвестно" },
  error: { Icon: X, tone: "text-destructive", title: "Ошибка разбора" },
} as const;

/** Статус разбора сообщения: ✓ разобрано, ? неизвестно, ✗ ошибка. */
export function StatusIcon({
  status,
  className,
}: {
  status: ParseStatus;
  className?: string;
}) {
  const { Icon, tone, title } = STATUS[status];

  return (
    <span
      role="img"
      title={title}
      aria-label={title}
      className={cn("inline-flex shrink-0", tone, className)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  );
}
