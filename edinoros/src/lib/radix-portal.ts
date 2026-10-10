/**
 * Radix рендерит выпадающие слои (Select, Popover, DropdownMenu, Dialog) в портал
 * в document.body. Для обработчика «клик вне» такой слой выглядит как клик снаружи,
 * хотя визуально он — часть панели, из которой открыт.
 *
 * Опознаём по атрибутам data-slot, которые ставит shadcn, и по ролям Radix.
 * Атрибута data-radix-popper-content-wrapper в radix-ui 1.7 нет — проверено,
 * полагаться на него нельзя.
 */
const PORTAL_SELECTOR = [
  '[data-slot="select-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="tooltip-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="sheet-content"]',
  '[role="listbox"]',
  '[role="menu"]',
].join(", ");

/** Лежит ли цель клика внутри портального слоя Radix. */
export function isInsideRadixPortal(target: Node | null): boolean {
  return target instanceof Element && target.closest(PORTAL_SELECTOR) !== null;
}
