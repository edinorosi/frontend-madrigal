import { THEME_STORAGE_KEY } from "@/src/store/theme";

/**
 * Скрипт выставляется в <head> и выполняется до первой отрисовки,
 * чтобы применить сохранённую тему без вспышки неверной темы (FOUC).
 * Логики приложения не содержит — только чтение localStorage и системной темы.
 */
const script = `
(function () {
  try {
    var stored = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  } catch (error) {
    /* нет доступа к localStorage — остаётся тема по умолчанию */
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
