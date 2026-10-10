"use client";

import { ImportButton } from "@/components/import-button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { captureTitle, formatBytes } from "@/src/lib/format";
import { useAppStore } from "@/src/store/app";

export function Topbar() {
  const capture = useAppStore(
    (state) =>
      state.captures.find((item) => item.id === state.activeCaptureId) ?? null,
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-sidebar px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">
          {captureTitle(capture)}
        </span>
        {capture ? (
          <Badge
            variant="secondary"
            className="shrink-0 font-mono text-[11px]"
            title={`Импортировано ${capture.importedAt}`}
          >
            {formatBytes(capture.sizeBytes)}
          </Badge>
        ) : null}
        <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">
          модель —
        </Badge>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ImportButton size="sm" variant="outline" />
        <Separator orientation="vertical" className="mx-1 !h-5" />
        <ThemeToggle />
      </div>
    </header>
  );
}
