"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/src/store/app";

/**
 * Создание проекта: только имя. Запись PCAP загружается отдельной кнопкой
 * на стартовой странице — так пустой проект не тащит за собой лишних шагов.
 *
 * Esc и закрытие держат overlayOpen (как ConfirmDialog): иначе Esc уйдёт
 * каскадом к панелям под диалогом.
 */
export function CreateProjectDialog({
  open,
  onCancel,
  onCreate,
}: {
  open: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  useEffect(() => {
    setOverlayOpen(open);
    if (open) setName("");
  }, [open, setOverlayOpen]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onCreate(name);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOverlayOpen(next);
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Новый проект</DialogTitle>
            <DialogDescription>
              Имя проекта в списке. Пустое значение — «Новый проект».
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Новый проект"
              aria-label="Имя проекта"
            />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Отмена
            </Button>
            <Button type="submit" size="sm">
              Создать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
