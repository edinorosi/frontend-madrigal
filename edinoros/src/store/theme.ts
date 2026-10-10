import { create } from "zustand";

export type Theme = "light" | "dark";

/** Ключ, под которым тема хранится в localStorage. Читается и pre-hydration скриптом. */
export const THEME_STORAGE_KEY = "edinoros-theme";

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

/**
 * Тема, уже применённая pre-hydration скриптом в layout.tsx.
 * На сервере document недоступен — там всегда "light", отсюда гейт по mounted в ThemeToggle.
 */
function readAppliedTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readAppliedTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage может быть недоступен (приватный режим) — тема всё равно применена.
    }
    set({ theme });
  },
  toggleTheme: () => {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },
}));
