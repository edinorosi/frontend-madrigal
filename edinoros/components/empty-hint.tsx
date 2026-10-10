import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Нейтральная подсказка для пустых областей. Текст задаётся вызывающей стороной. */
export function EmptyHint({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center px-6 text-center",
        className,
      )}
    >
      <p className="max-w-[24rem] text-xs leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
