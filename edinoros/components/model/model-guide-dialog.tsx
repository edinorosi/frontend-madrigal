"use client";

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MODEL_HELP } from "@/src/lib/model-help";
import { useAppStore } from "@/src/store/app";

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium">{title}</h3>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function GuideRow({ term, text }: { term: string; text: string }) {
  return (
    <p>
      <span className="font-mono text-foreground">{term}</span>
      {" — "}
      {text}
    </p>
  );
}

/**
 * Гайд по разделу «Модели»: всё в одном месте.
 * Открывается кнопкой справа снизу в редакторе модели.
 * Как ConfirmDialog, держит overlayOpen, чтобы Esc доставался
 * диалогу, а не панелям под ним.
 */
export function ModelGuideDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const setOverlayOpen = useAppStore((state) => state.setOverlayOpen);

  useEffect(() => {
    setOverlayOpen(open);
  }, [open, setOverlayOpen]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOverlayOpen(next);
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Как устроены модели</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-4 pr-4">
            <GuideSection title="Правила и условия">
              <p>{MODEL_HELP.ruleOrder}</p>
              <GuideRow term="opcodes" text={MODEL_HELP.opcodes} />
              <GuideRow term="maxMessageLength" text={MODEL_HELP.maxMessageLength} />
              <GuideRow term="messageLength" text={MODEL_HELP.messageLength} />
              <GuideRow term="Всегда (fallback)" text={MODEL_HELP.fallback} />
            </GuideSection>
            <GuideSection title="Поля">
              <p>{MODEL_HELP.fieldsList}</p>
              <GuideRow term="имя" text={MODEL_HELP.fieldName} />
              <GuideRow term="тип" text={MODEL_HELP.fieldType} />
              <GuideRow term="смещение" text={MODEL_HELP.fieldOffset} />
              <GuideRow term="end-2" text={MODEL_HELP.fieldOffsetEnd2} />
              <GuideRow term="длина" text={MODEL_HELP.fieldLength} />
              <GuideRow term="rest / rest-2" text={MODEL_HELP.fieldLengthRest} />
              <GuideRow term="note" text={MODEL_HELP.fieldNote} />
            </GuideSection>
            <GuideSection title="Модели и статус">
              <p>{MODEL_HELP.modelsList}</p>
              <p>{MODEL_HELP.modelStatus}</p>
            </GuideSection>
            <GuideSection title="Кнопки">
              <GuideRow term="Распознать паттерны" text={MODEL_HELP.recognize} />
              <GuideRow term="Вывести модель" text={MODEL_HELP.infer} />
              <GuideRow term="Применить к записи" text={MODEL_HELP.apply} />
              <GuideRow term="Импорт правила" text={MODEL_HELP.importRule} />
            </GuideSection>
            <GuideSection title="Превью">
              <p>{MODEL_HELP.preview}</p>
            </GuideSection>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
