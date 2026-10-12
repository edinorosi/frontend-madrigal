/**
 * Модель сообщения (R10.1): у каждого сообщения может быть своя модель
 * разбора. Пустая ссылка — наследуется активная модель проекта.
 */
import type { Message, Model } from "@/src/types/domain";

/**
 * Модель, которой разбирается сообщение: явная ссылка `Message.modelId`,
 * иначе активная модель проекта. Если явная ссылка ведёт на удалённую
 * или неизвестную модель — тихий fallback на активную.
 */
export function resolveMessageModel(
  message: Pick<Message, "modelId"> | null,
  models: Model[] | null,
  activeModelId: string | null,
): Model | null {
  const wanted = message?.modelId ?? null;
  if (wanted !== null) {
    const found = models?.find((item) => item.id === wanted) ?? null;
    if (found) return found;
  }
  return models?.find((item) => item.id === activeModelId) ?? null;
}
