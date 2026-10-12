"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusIcon } from "@/components/status-icon";
import { useAppStore } from "@/src/store/app";
import type { Message } from "@/src/types/domain";

/** packetNumber — номер пакета-источника в записи (§ поле Message). */
const PACKET_NUMBER_TITLE = "Номер пакета в записи";

/**
 * Метка сообщения: «GET_STATUS · ответ» → заголовок «GET_STATUS», метка «ответ».
 * Метка — вторичный признак (ответ, перегрев), она вторична и приглушена.
 */
function splitLabel(label: string): { title: string; meta: string | null } {
  const separator = label.indexOf("·");
  if (separator === -1) return { title: label, meta: null };

  const title = label.slice(0, separator).trim();
  const meta = label.slice(separator + 1).trim();
  return { title: title || label, meta: meta || null };
}

/**
 * Строка сообщения: номер (вторичный) → название (главное) → метка →
 * направление + статус (справа, иконками).
 *
 * Один компонент для sidebar и Popover «Сравнить с…».
 */
export function MessageRow({
  message,
  className,
}: {
  message: Message;
  className?: string;
}) {
  const models = useAppStore((state) => state.models);
  const { title, meta } = splitLabel(message.label);
  const isRequest = message.direction === "request";
  // Своя модель сообщения (R10.1): тонкий значок, только если отличается
  // от наследуемой. Список тесный — имя показывается в тултипе.
  const linkedModelName = message.modelId
    ? (models?.find((item) => item.id === message.modelId)?.name ??
      message.modelId)
    : null;

  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span
        title={PACKET_NUMBER_TITLE}
        className="shrink-0 font-mono text-[10px] text-muted-foreground"
      >
        №{message.packetNumber}
      </span>
      <span className="truncate font-medium text-foreground">{title}</span>
      {meta ? (
        <span className="truncate text-[10px] text-muted-foreground">
          {meta}
        </span>
      ) : null}
      {linkedModelName ? (
        <span
          title={`Модель: ${linkedModelName}`}
          className="shrink-0 rounded border border-border/60 px-0.5 text-[9px] text-muted-foreground"
        >
          M
        </span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {isRequest ? (
          <ArrowRight
            className="size-3 text-muted-foreground"
            aria-label="Запрос"
          />
        ) : (
          <ArrowLeft
            className="size-3 text-muted-foreground"
            aria-label="Ответ"
          />
        )}
        <StatusIcon status={message.status} />
      </span>
    </span>
  );
}
