"use client";

import type { Priority } from "@/lib/types";

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  priorityFilter: Priority | "ALL";
  onPriorityChange: (value: Priority | "ALL") => void;
}

const PRIORITIES: { value: Priority | "ALL"; label: string }[] = [
  { value: "ALL", label: "Все" },
  { value: "P0", label: "P0" },
  { value: "P1", label: "P1" },
  { value: "P2", label: "P2" },
  { value: "P3", label: "P3" },
];

export function FilterBar({
  search,
  onSearchChange,
  priorityFilter,
  onPriorityChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        placeholder="Поиск..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-48 rounded border bg-transparent px-3 py-1.5 text-sm text-[var(--arena-text)] placeholder-[var(--arena-muted-soft)] focus:border-[var(--arena-selection-border)] focus:outline-none sm:w-56"
      />

      <div className="flex gap-1">
        {PRIORITIES.map((p) => (
          <button
            key={p.value}
            onClick={() => onPriorityChange(p.value)}
            className={`mono rounded px-2 py-1 text-[11px] ${
              priorityFilter === p.value
                ? "bg-[var(--arena-hover)] text-[var(--arena-text)]"
                : "text-[var(--arena-muted)] hover:text-[var(--arena-text)]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
