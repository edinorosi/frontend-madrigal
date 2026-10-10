"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAppStore } from "@/src/store/app";
import type { Direction, Message, ParseStatus } from "@/src/types/domain";

const DIRECTION_MARK: Record<Direction, string> = {
  request: "→",
  response: "←",
};

const STATUS_MARK: Record<ParseStatus, string> = {
  parsed: "✓",
  unknown: "?",
  error: "✗",
};

/**
 * Подпись сообщения в списке выбора: №31 · → · GET_STATUS · ✓
 * Направление и статус — обычным текстом, без бейджей и цвета.
 */
function messageCaption(message: Message): string {
  const direction = DIRECTION_MARK[message.direction];
  const status = STATUS_MARK[message.status];
  return `№${message.packetNumber} · ${direction} · ${message.label} · ${status}`;
}

/**
 * Кнопка «Сравнить с…» внизу панели интерпретации и список сообщений
 * текущей сессии для выбора второго сообщения.
 *
 * Список — Popover + Command: у Select из shadcn нет поля поиска, Radix
 * перехватывает клавиатуру в listbox. Command и cmdk уже в проекте.
 */
export function ComparePicker() {
  const messages = useAppStore((state) => state.messages);
  const activeMessageId = useAppStore((state) => state.activeMessageId);
  const bytesA = useAppStore((state) => state.bytes);
  const bytesALoading = useAppStore((state) => state.loading.bytes);
  const compareError = useAppStore((state) => state.compareError);
  const compareAttemptId = useAppStore((state) => state.compareAttemptId);
  const startCompare = useAppStore((state) => state.startCompare);
  const stopCompare = useAppStore((state) => state.stopCompare);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const [open, setOpen] = useState(false);

  // Пока портал открыт, Esc принадлежит ему, а не HEX.
  useEffect(
    () => () => {
      setOverlayOpen(false);
    },
    [setOverlayOpen],
  );

  // Байты A готовы, если они есть и загрузка завершена. Сбой загрузки оставляет
  // bytes пустым при loading = false — отдельный признак ошибки не нужен.
  const bytesAReady = bytesA !== null && !bytesALoading;

  // Сравнивать не с чем: нет второго сообщения, не выбран A, байты A не готовы.
  if (messages.length <= 1 || activeMessageId === null || !bytesAReady) {
    return null;
  }

  if (compareError) {
    return (
      <div className="flex shrink-0 flex-col gap-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5">
        <p className="text-[11px] text-destructive">{compareError}</p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (compareAttemptId) void startCompare(compareAttemptId);
            }}
          >
            Повторить
          </Button>
          <Button size="sm" variant="ghost" onClick={stopCompare}>
            Отмена
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setOverlayOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full shrink-0">
          Сравнить с…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,90vw)] p-0">
        <Command>
          <CommandInput placeholder="Поиск сообщения" />
          <CommandList>
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            {messages.map((message) => (
              <CommandItem
                key={message.id}
                value={messageCaption(message)}
                disabled={message.id === activeMessageId}
                onSelect={() => {
                  setOpen(false);
                  setOverlayOpen(false);
                  void startCompare(message.id);
                }}
              >
                <span className="truncate">{messageCaption(message)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
