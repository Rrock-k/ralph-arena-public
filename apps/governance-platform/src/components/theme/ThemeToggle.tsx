"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "governance-theme";

const OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function applyTheme(mode: ThemeMode) {
  void mode;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
    setTheme(initial);
    applyTheme(initial);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((window.localStorage.getItem(STORAGE_KEY) ?? "system") === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function handleChange(mode: ThemeMode) {
    setTheme(mode);
    window.localStorage.setItem(STORAGE_KEY, mode);
    applyTheme(mode);
    window.dispatchEvent(new Event("governance-theme-change"));
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white/90 p-0.5 dark:border-slate-700 dark:bg-slate-900/90">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => handleChange(value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-gray-900 text-white dark:bg-emerald-500 dark:text-slate-950"
                : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
            aria-pressed={active}
            title={label}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
