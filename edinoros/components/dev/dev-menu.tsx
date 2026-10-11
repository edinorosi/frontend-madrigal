"use client";

/**
 * ВРЕМЕННЫЙ DEV-ПУЛЬТ. Удаляется вместе с src/services/mock/scenarios.ts
 * при подключении бэкенда.
 *
 * Ни в production-сборку, ни в связку с бэкендом не попадает:
 * подключается в app/page.tsx только при NODE_ENV !== "production".
 *
 * Дёргает ровно те же useAppStore и appService, что и настоящий интерфейс,
 * поэтому проверяет реальные состояния, а не отдельную «демо-реальность».
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Bug, Download, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SCENARIOS,
  useMockSettings,
  type ScenarioId,
} from "@/src/services/mock/scenarios";
import { useAppStore, type LoadingKey } from "@/src/store/app";
import { useThemeStore } from "@/src/store/theme";

const LATENCY_OPTIONS = [
  { value: "0", label: "без задержки" },
  { value: "120", label: "120 мс" },
  { value: "600", label: "600 мс" },
  { value: "1500", label: "1500 мс — видно скелетоны" },
];

const LOADING_LABELS: Record<LoadingKey, string> = {
  captures: "записи",
  sessions: "сессии",
  messages: "сообщения",
  bytes: "байты",
  observations: "наблюдения",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function StateRow({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-muted-foreground">{name}</span>
      <span className="truncate font-mono text-xs">{value}</span>
    </div>
  );
}

export function DevMenu() {
  const [open, setOpen] = useState(false);

  const scenario = useMockSettings((state) => state.scenario);
  const latencyMs = useMockSettings((state) => state.latencyMs);
  const importFails = useMockSettings((state) => state.importFails);
  const importDurationMs = useMockSettings((state) => state.importDurationMs);

  const importPhase = useAppStore((state) => state.importPhase);
  const importProgress = useAppStore((state) => state.importProgress);
  const importError = useAppStore((state) => state.importError);
  const setImportProgress = useAppStore((state) => state.setImportProgress);

  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isToggle =
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "d";
      if (!isToggle) return;
      event.preventDefault();
      setOpen((value) => !value);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const reload = useCallback(async () => {
    useAppStore.getState().resetProject();
    await useAppStore.getState().loadProject();
  }, []);

  const applyScenario = useCallback(
    async (next: ScenarioId) => {
      useMockSettings.getState().setScenario(next);
      useMockSettings.getState().clearImportedCaptures();
      await reload();
    },
    [reload],
  );

  const runImport = useCallback(async () => {
    const file = new File([new Uint8Array(8192)], "bench-2026-03-14.pcapng", {
      type: "application/octet-stream",
    });

    const startedAt = performance.now();
    let frame = requestAnimationFrame(function tick() {
      const elapsed = performance.now() - startedAt;
      setImportProgress(Math.min(0.9, elapsed / importDurationMs));
      frame = requestAnimationFrame(tick);
    });

    try {
      await useAppStore.getState().startImport(file);
    } finally {
      cancelAnimationFrame(frame);
    }
  }, [importDurationMs, setImportProgress]);

  const state = useAppStore();
  const loadingKeys = (Object.keys(LOADING_LABELS) as LoadingKey[]).filter(
    (key) => state.loading[key],
  );
  const activeMessage = state.messages.find(
    (message) => message.id === state.activeMessageId,
  );

  if (!open) {
    return (
      <Button
        size="icon"
        variant="secondary"
        className="fixed right-3 bottom-9 z-50 shadow-md"
        onClick={() => setOpen(true)}
        aria-label="Открыть тестовое меню (Ctrl+Shift+D)"
        title="Тестовое меню (Ctrl+Shift+D)"
      >
        <Bug className="size-4" />
      </Button>
    );
  }

  return (
    <aside
      className={cn(
        "fixed right-3 bottom-9 z-50 flex max-h-[75vh] w-[380px] flex-col",
        "rounded-lg border bg-popover shadow-lg",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Bug className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Тестовое меню</span>
        <Badge variant="secondary" className="font-mono text-[10px]">
          dev
        </Badge>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-6"
          onClick={() => setOpen(false)}
          aria-label="Закрыть тестовое меню"
        >
          <X className="size-4" />
        </Button>
      </header>

      <Tabs defaultValue="scenario" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="shrink-0 border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="scenario" className="flex-1 text-xs">
              Сценарий
            </TabsTrigger>
            <TabsTrigger value="actions" className="flex-1 text-xs">
              Действия
            </TabsTrigger>
            <TabsTrigger value="state" className="flex-1 text-xs">
              Состояние
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="scenario" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4 p-3">
              <Field label="Сценарий">
                <Select
                  value={scenario}
                  onValueChange={(value) => {
                    void applyScenario(value as ScenarioId);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCENARIOS.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {SCENARIOS.find((item) => item.id === scenario)?.description}
                </p>
              </Field>

              <Field label="Задержка ответа мока">
                <Select
                  value={String(latencyMs)}
                  onValueChange={(value) => {
                    useMockSettings
                      .getState()
                      .setLatency(Number.parseInt(value, 10));
                    void reload();
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LATENCY_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Separator />

              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <Label
                    htmlFor="dev-import-fails"
                    className="text-xs font-normal"
                  >
                    Импорт падает с ошибкой
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    Проверка состояния «ошибка разбора»
                  </span>
                </div>
                <Switch
                  id="dev-import-fails"
                  checked={importFails}
                  onCheckedChange={(checked) =>
                    useMockSettings.getState().setImportFails(checked)
                  }
                />
              </div>

              <Field label={`Длительность импорта · ${importDurationMs} мс`}>
                <Select
                  value={String(importDurationMs)}
                  onValueChange={(value) =>
                    useMockSettings
                      .getState()
                      .setImportDuration(Number.parseInt(value, 10))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="300">300 мс</SelectItem>
                    <SelectItem value="1400">1400 мс</SelectItem>
                    <SelectItem value="5000">5000 мс</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Separator />

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="dev-dark" className="text-xs font-normal">
                  Тёмная тема
                </Label>
                <Switch
                  id="dev-dark"
                  checked={theme === "dark"}
                  onCheckedChange={toggleTheme}
                />
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="actions" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4 p-3">
              <Section title="Проект">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => void useAppStore.getState().loadProject()}
                  >
                    Загрузить проект
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      useMockSettings.getState().reset();
                      void reload();
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                    Сбросить
                  </Button>
                </div>
              </Section>

              <Section title="Импорт записи">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importPhase === "running"}
                  onClick={() => void runImport()}
                >
                  <Download className="size-3.5" />
                  Импортировать PCAP
                </Button>

                {importPhase === "running" ? (
                  <div className="flex flex-col gap-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-[width] duration-100"
                        style={{ width: `${importProgress * 100}%` }}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => useAppStore.getState().cancelImport()}
                    >
                      Отменить
                    </Button>
                  </div>
                ) : null}

                {importError ? (
                  <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                    <span className="text-xs text-destructive">
                      {importError}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        useAppStore.getState().dismissImportError()
                      }
                    >
                      Скрыть
                    </Button>
                  </div>
                ) : null}
              </Section>

              <Section title="Сессия">
                <Select
                  value={state.activeSessionId ?? ""}
                  onValueChange={(value) => {
                    void useAppStore.getState().selectSession(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="не выбрана" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.sessions.map((session) => (
                      <SelectItem key={session.id} value={session.id}>
                        {session.tuple.source.address}:
                        {session.tuple.source.port} · {session.messageCount}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!state.activeSessionId}
                  onClick={() => {
                    useAppStore.setState({
                      activeSessionId: null,
                      messages: [],
                      activeMessageId: null,
                      bytes: null,
                      observations: [],
                      selection: null,
                    });
                  }}
                >
                  Снять выбор сессии
                </Button>
              </Section>

              <Section title="Сообщение">
                <Select
                  value={state.activeMessageId ?? ""}
                  onValueChange={(value) => {
                    void useAppStore.getState().selectMessage(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="не выбрано" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.messages.slice(0, 200).map((message) => (
                      <SelectItem key={message.id} value={message.id}>
                        {message.direction === "request" ? "→" : "←"}{" "}
                        {message.label} · {message.length} Б
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!state.activeMessageId}
                  onClick={() => {
                    useAppStore.setState({
                      activeMessageId: null,
                      bytes: null,
                      observations: [],
                      selection: null,
                    });
                  }}
                >
                  Снять выбор сообщения
                </Button>
              </Section>

              <Section title="Выделение байтов">
                {activeMessage && activeMessage.fields.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {activeMessage.fields.map((field) => (
                      <Button
                        key={field.id}
                        size="sm"
                        variant="outline"
                        className="font-mono text-[11px]"
                        onClick={() =>
                          useAppStore.getState().setSelection(field.range)
                        }
                      >
                        {field.name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Нужно выбрать разобранное сообщение
                  </p>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!state.selection}
                  onClick={() => useAppStore.getState().setSelection(null)}
                >
                  Снять выделение
                </Button>
              </Section>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="state" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-3">
              <Section title="Данные">
                <StateRow name="записей" value={state.captures.length} />
                <StateRow
                  name="активная запись"
                  value={state.activeCaptureId ?? "—"}
                />
                <StateRow name="сессий" value={state.sessions.length} />
                <StateRow
                  name="активная сессия"
                  value={state.activeSessionId ?? "—"}
                />
                <StateRow name="сообщений" value={state.messages.length} />
                <StateRow
                  name="активное сообщение"
                  value={state.activeMessageId ?? "—"}
                />
                <StateRow
                  name="байтов получено"
                  value={state.bytes ? state.bytes.length : "—"}
                />
                <StateRow name="наблюдений" value={state.observations.length} />
              </Section>

              <Separator />

              <Section title="Выделение">
                <StateRow
                  name="диапазон"
                  value={
                    state.selection
                      ? `${state.selection.offset} +${state.selection.length}`
                      : "—"
                  }
                />
                <StateRow
                  name="наведённое поле"
                  value={state.hoveredFieldId ?? "—"}
                />
              </Section>

              <Separator />

              <Section title="Загрузка">
                <StateRow
                  name="идёт"
                  value={
                    loadingKeys.length > 0
                      ? loadingKeys.map((key) => LOADING_LABELS[key]).join(", ")
                      : "ничего"
                  }
                />
                <StateRow name="импорт" value={importPhase} />
                <StateRow
                  name="ошибка"
                  value={state.error ?? "нет"}
                />
                <StateRow
                  name="ошибка сообщений"
                  value={state.messagesError ?? "нет"}
                />
              </Section>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
