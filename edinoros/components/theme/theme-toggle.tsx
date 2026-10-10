"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/src/store/theme";

const noopSubscribe = () => () => {};

/**
 * Переключатель светлой и тёмной темы.
 * Тема применяется pre-hydration скриптом, поэтому до гидратации иконка не рендерится:
 * серверная и клиентская разметка должны совпадать (отсюда useSyncExternalStore вместо эффекта).
 */
export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const label = !mounted
    ? "Переключить тему"
    : theme === "dark"
      ? "Включить светлую тему"
      : "Включить тёмную тему";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {!mounted ? (
        <span className="size-4" />
      ) : theme === "dark" ? (
        <Moon className="size-4" />
      ) : (
        <Sun className="size-4" />
      )}
    </Button>
  );
}
