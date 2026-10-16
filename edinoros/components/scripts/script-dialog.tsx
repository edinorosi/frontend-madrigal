"use client";

import { useRef, useState } from "react";
import { Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SCRIPT_PRESETS } from "@/src/lib/script-presets";
import { useAppStore } from "@/src/store/app";

interface RunResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

function baseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? "";
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Диалог «Скрипты» (п.3): Python выполняется сервером
 * (POST /api/v1/scripts/run), вывод возвращается сюда.
 * Без NEXT_PUBLIC_API_URL — только моки, запуск недоступен.
 */
export function ScriptDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const activeCaptureId = useAppStore((state) => state.activeCaptureId);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);
  const [presetId, setPresetId] = useState(SCRIPT_PRESETS[0].id);
  const [code, setCode] = useState(SCRIPT_PRESETS[0].code);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const configured = baseUrl() !== "";

  const handleFile = async (file: File) => {
    try {
      setCode(await file.text());
      setPresetId("");
      setFileName(file.name);
      setResult(null);
      setError(null);
    } catch {
      setError("Не удалось прочитать файл");
    }
  };

  const handlePreset = (id: string) => {
    setPresetId(id);
    setFileName(null);
    const preset = SCRIPT_PRESETS.find((item) => item.id === id);
    if (preset) {
      setCode(preset.code);
      setResult(null);
      setError(null);
    }
  };

  const handleRun = async () => {
    if (!configured || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      const token = process.env.NEXT_PUBLIC_API_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${baseUrl()}/api/v1/scripts/run`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          script: code,
          capture_id: activeCaptureId ?? undefined,
        }),
      });
      if (!response.ok) {
        if (response.status === 404) {
          setError("Бэкенд старый (нет /scripts/run) — пересобери protocol-lab-api в sidecar");
          return;
        }
        let detail = `${response.status}`;
        try {
          const body: unknown = await response.json();
          if (
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
          ) {
            detail = body.error;
          }
        } catch {
          // не JSON — показываем статус
        }
        setError(detail);
        return;
      }
      setResult((await response.json()) as RunResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось запустить");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOverlayOpen(next);
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Скрипты Python</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={presetId} onValueChange={handlePreset} onOpenChange={setOverlayOpen}>
              <SelectTrigger className="h-7 w-64 text-xs">
                <SelectValue placeholder={fileName ?? "Выбери пример…"} />
              </SelectTrigger>
              <SelectContent>
                {SCRIPT_PRESETS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              title="Загрузить свой .py файл в редактор"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3.5" />
              {fileName ?? "Файл"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".py,text/x-python"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleFile(file);
              }}
            />
            <span className="font-mono text-[11px] text-muted-foreground">
              {activeCaptureId
                ? `запись ${activeCaptureId.slice(0, 8)}…`
                : "без записи"}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 gap-1 px-2"
              disabled={!configured || running || code.trim() === ""}
              title="Выполнить скрипт на сервере"
              onClick={() => void handleRun()}
            >
              <Play className="size-3.5" />
              {running ? "Выполняется…" : "Запустить"}
            </Button>
          </div>
          {!configured ? (
            <p className="text-xs text-warn">
              Бэкенд не подключён (нет NEXT_PUBLIC_API_URL) — запуск недоступен, код можно править.
            </p>
          ) : null}
          <Textarea
            value={code}
            onChange={(event) => setCode(event.target.value)}
            spellCheck={false}
            className="max-h-[35dvh] min-h-40 overflow-y-auto font-mono text-xs"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {result ? (
            <ScrollArea className="max-h-48 rounded border">
              <div className="flex flex-col gap-1 p-2 font-mono text-[11px]">
                <span className="text-muted-foreground">
                  код {result.exit_code}
                  {result.timed_out ? " · таймаут" : ""}
                </span>
                {result.stdout ? (
                  <pre className="whitespace-pre-wrap">{result.stdout}</pre>
                ) : null}
                {result.stderr ? (
                  <pre className="whitespace-pre-wrap text-destructive">
                    {result.stderr}
                  </pre>
                ) : null}
              </div>
            </ScrollArea>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ScriptButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 px-2"
        title="Скрипты Python на сервере"
        onClick={() => setOpen(true)}
      >
        Скрипты
      </Button>
      <ScriptDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
