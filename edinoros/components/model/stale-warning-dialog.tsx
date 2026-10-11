"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/src/store/app";

/** Сколько строк перечислять в списке, прежде чем оставить счётчик. */
const ITEM_LIMIT = 8;

/**
 * Предупреждение об устаревании (R9.2): правила изменились при закрытии
 * редактора — возможно, связанные наблюдения устарели. Статусы не гасятся
 * автоматически: предлагается отметить вручную или оставить как есть.
 */
export function StaleWarningDialog() {
  const staleWarning = useAppStore((state) => state.staleWarning);
  const markStale = useAppStore((state) => state.markStaleWarningObservations);
  const dismiss = useAppStore((state) => state.dismissStaleWarning);
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  const open = staleWarning !== null;
  const rules = staleWarning?.ruleNames ?? [];
  const items = staleWarning?.items ?? [];
  const observations = staleWarning?.observations ?? [];
  const count = staleWarning?.count ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOverlayOpen(next);
        if (!next) dismiss();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {rules.length === 1 ? "Правило изменилось" : "Правила изменились"}
          </DialogTitle>
          <DialogDescription>
            Возможно, наблюдения, основанные на этих правилах, устарели
            (затронуто: {count}).
          </DialogDescription>
        </DialogHeader>

        <p className="font-mono text-xs">
          {rules.map((name) => `«${name}»`).join(", ")}
        </p>

        <ScrollArea className="max-h-40">
          <ul className="flex flex-col gap-0.5">
            {observations.slice(0, ITEM_LIMIT).map((observation, index) => (
              <li key={observation.id} className="text-xs">
                {items[index]}
              </li>
            ))}
          </ul>
        </ScrollArea>
        {items.length > ITEM_LIMIT ? (
          <p className="text-[10px] text-muted-foreground">
            и ещё {items.length - ITEM_LIMIT}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>
            Оставить
          </Button>
          <Button
            onClick={() => {
              void markStale();
            }}
          >
            Отметить как устаревшие
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
