"use client";

import { useEffect } from "react";
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

/**
 * Подтверждение необратимого действия (удаление).
 * Отдельный от Story-диалогов компонент: живёт рядом с остальным UI
 * и держит overlayOpen, чтобы Esc достался диалогу, а не панелям.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Удалить",
  cancelLabel = "Отмена",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  // Открытый диалог забирает Esc: держим overlayOpen синхронно с `open`,
  // иначе Esc уйдёт каскадом в панели под диалогом.
  useEffect(() => {
    setOverlayOpen(open);
  }, [open, setOverlayOpen]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOverlayOpen(next);
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
