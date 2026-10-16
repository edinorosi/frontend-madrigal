"use client";

import { useRef, useState, type ComponentProps } from "react";
import { BookUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/src/store/app";
import type { JournalScope } from "@/src/types/domain";

type ButtonProps = ComponentProps<typeof Button>;

/**
 * Загрузка CSV-журнала действий через фронт.
 * Скоуп — по желанию пользователя: «К этой записи» или «Общий».
 * Файл уходит на бэк multipart-формой, фронт его не парсит.
 */
export function JournalImportButton({ ...props }: ButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<JournalScope>("capture");
  const startJournalImport = useAppStore((state) => state.startJournalImport);
  const uploading = useAppStore((state) => state.journalUploading);
  const journalError = useAppStore((state) => state.journalError);
  const journalUploadNotice = useAppStore(
    (state) => state.journalUploadNotice,
  );
  const dismissJournalError = useAppStore(
    (state) => state.dismissJournalError,
  );
  const activeCaptureId = useAppStore((state) => state.activeCaptureId);

  const pickFile = (next: JournalScope): void => {
    setScope(next);
    inputRef.current?.click();
  };

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {journalUploadNotice ? (
        <span
          role="status"
          className="max-w-48 truncate text-[11px] text-ok"
          title={journalUploadNotice}
        >
          {journalUploadNotice}
        </span>
      ) : null}
      {journalError ? (
        <button
          type="button"
          className="max-w-48 truncate text-[11px] text-destructive underline"
          title={`${journalError} — скрыть`}
          onClick={() => dismissJournalError()}
        >
          {journalError}
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void startJournalImport(file, scope);
          }
          event.target.value = "";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button {...props} disabled={uploading || props.disabled}>
            <BookUp className="size-4" />
            {uploading ? "Журнал…" : "Журнал"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem
            disabled={uploading || !activeCaptureId}
            title={
              activeCaptureId
                ? "Журнал только для активной записи"
                : "Нет активной записи — откройте запись"
            }
            onSelect={() => pickFile("capture")}
          >
            К этой записи (.csv)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={uploading}
            title="Журнал для всех записей"
            onSelect={() => pickFile("global")}
          >
            Общий (.csv)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
