"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "governance-theme";

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function AdminThemeShell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const update = () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const mode: ThemeMode =
        stored === "light" || stored === "dark" || stored === "system"
          ? stored
          : "system";
      setTheme(resolveTheme(mode));
    };

    update();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    window.addEventListener("storage", update);
    window.addEventListener("governance-theme-change", update as EventListener);

    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", update);
      window.removeEventListener("governance-theme-change", update as EventListener);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const isDark = theme === "dark";

    root.classList.toggle("dark", isDark);
    body.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
    body.style.colorScheme = isDark ? "dark" : "light";

    return () => {
      root.classList.remove("dark");
      body.classList.remove("dark");
      root.style.colorScheme = "";
      body.style.colorScheme = "";
    };
  }, [theme]);

  return (
    <div
      className={theme === "dark" ? "dark min-h-[100dvh]" : "min-h-[100dvh]"}
      style={{ colorScheme: theme }}
    >
      {children}
      <Toaster position="top-right" theme={theme} closeButton />
    </div>
  );
}
