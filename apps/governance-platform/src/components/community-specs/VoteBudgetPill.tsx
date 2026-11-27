"use client";

import type { VoteBudget } from "./mock-data";

interface VoteBudgetPillProps {
  budget: VoteBudget;
}

export function VoteBudgetPill({ budget }: VoteBudgetPillProps) {
  const remaining = budget.max - budget.used;
  const exhausted = remaining <= 0;
  const low = remaining > 0 && remaining <= 1;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
        exhausted
          ? "border-rose-400/20 bg-rose-500/[0.05] text-rose-400"
          : low
            ? "border-amber-400/20 bg-amber-500/[0.05] text-amber-300"
            : "border-white/10 bg-white/[0.03] text-slate-400"
      }`}
    >
      {/* Dots */}
      <span className="flex gap-0.5">
        {Array.from({ length: budget.max }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              i < budget.used
                ? "bg-slate-600"
                : exhausted
                  ? "bg-rose-400/40"
                  : "bg-emerald-400"
            }`}
          />
        ))}
      </span>
      <span className="mono text-[10px] font-semibold">
        {remaining}/{budget.max}
      </span>
      <span className="text-[10px]">votes left today</span>
    </div>
  );
}
