export type Theme = "light" | "dark";
export function resolveTheme(saved: unknown, dark: boolean): Theme {
  return saved === "light" || saved === "dark" ? saved : dark ? "dark" : "light";
}
export function readTheme(): Theme {
  let saved: unknown;
  try {
    saved = localStorage.getItem("unframe.editor.theme");
  } catch {}
  return resolveTheme(saved, matchMedia("(prefers-color-scheme: dark)").matches);
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem("unframe.editor.theme", theme);
  } catch {}
  applyTheme(theme);
}
