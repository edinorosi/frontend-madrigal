import type { ModelStatus } from "@/src/types/domain";

/** Русские названия статусов модели — для бейджей в панелях и редакторе. */
export const MODEL_STATUS_LABEL: Record<ModelStatus, string> = {
  draft: "черновик",
  checked: "проверена",
  stale: "устарела",
};

/** Цветовой тон статуса модели (классы темы: ok / warn / muted). */
export const MODEL_STATUS_TONE: Record<ModelStatus, string> = {
  draft: "text-muted-foreground",
  checked: "text-ok",
  stale: "text-warn",
};
