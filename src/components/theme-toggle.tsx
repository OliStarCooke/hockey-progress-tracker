import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
type Theme = "light" | "dark";
const themeKey = "progress-tracker:theme";
function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(themeKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#111113" : "#f7f8fa");
}
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function update() {
      const next = savedTheme() ?? (media.matches ? "dark" : "light");
      applyTheme(next);
      setTheme(next);
    }
    function storage(event: StorageEvent) {
      if (event.key === themeKey || event.key === null) update();
    }
    media.addEventListener("change", update);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", storage);
    };
  }, []);
  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    applyTheme(next);
    setTheme(next);
    try {
      localStorage.setItem(themeKey, next);
    } catch {
      /* Theme changes work even without storage. */
    }
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
    >
      <span className="theme-icon">
        <Sun size={16} className={theme === "dark" ? "icon-out" : "icon-in"} />
        <Moon
          size={16}
          className={theme === "light" ? "icon-out" : "icon-in"}
        />
      </span>
      <span>{theme === "light" ? "Light" : "Dark"}</span>
    </Button>
  );
}
