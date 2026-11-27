"use client";

import { useState } from "react";
import { toast } from "sonner";
import { setProjectBudgetLimit } from "@/app/actions/budget";

type BudgetLimitControlProps = {
  projectId: string;
  currentTotalCreditsUsd?: number;
  currentEnabled?: boolean;
};

export function BudgetLimitControl({
  projectId,
  currentTotalCreditsUsd = 0,
  currentEnabled = false,
}: BudgetLimitControlProps) {
  const [enabled, setEnabled] = useState(currentEnabled);
  const [total, setTotal] = useState(currentTotalCreditsUsd.toFixed(2));
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSave = async () => {
    const totalCreditsUsd = Number(total);
    if (!Number.isFinite(totalCreditsUsd) || totalCreditsUsd < 0) {
      toast.error("Enter a valid limit (>= 0)");
      return;
    }

    setIsSubmitting(true);
    const result = await setProjectBudgetLimit(projectId, totalCreditsUsd, enabled, note || undefined);
    setIsSubmitting(false);

    if (!result.success) {
      toast.error(result.error || "Failed to save budget limit");
      return;
    }

    toast.success(
      enabled
        ? `Budget limit saved: $${totalCreditsUsd.toFixed(2)} (${(result.remainingUsd ?? 0).toFixed(2)} remaining)`
        : "Budget limit disabled (runs are unlimited)",
    );
    setNote("");
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Budget Limit</p>
        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-violet-600 dark:border-slate-600"
          />
          Enabled
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,1fr,auto]">
        <input
          type="number"
          step="0.01"
          min="0"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          disabled={isSubmitting}
          placeholder="Total limit (USD)"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isSubmitting}
          placeholder="Note (optional)"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={isSubmitting}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Saving..." : "Save Limit"}
        </button>
      </div>
    </div>
  );
}
