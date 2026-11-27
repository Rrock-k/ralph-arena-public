"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Светлая", icon: Sun },
  { value: "dark", label: "Темная", icon: Moon },
  { value: "system", label: "Системная", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-[var(--arena-surface)] p-0.5">
      {THEMES.map(({ value, label, icon: Icon }) => {
        const active = (theme ?? "system") === value;

        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
              active
                ? "bg-[var(--arena-hover)] text-[var(--arena-text)]"
                : "text-[var(--arena-muted)] hover:text-[var(--arena-text)]"
            )}
            aria-pressed={active}
            aria-label={label}
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
