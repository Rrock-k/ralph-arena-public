"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setProjectBudgetLimit } from "@/app/actions/budget";
import { AddCreditsButton } from "../AddCreditsButton";

interface BudgetPanelProps {
  projectId: string;
  providerBillingMode?: string | null;
  budget?: {
    isEnabled: boolean;
    totalCreditsUsd: number;
    usedCreditsUsd: number;
  } | null;
  canEdit?: boolean;
  canFinanceAdmin?: boolean;
}

export function BudgetPanel({
  projectId,
  providerBillingMode,
  budget,
  canEdit = true,
  canFinanceAdmin = false,
}: BudgetPanelProps) {
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(budget?.totalCreditsUsd?.toFixed(2) ?? "0.00");
  const [enabled, setEnabled] = useState(budget?.isEnabled ?? false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const remaining = budget ? budget.totalCreditsUsd - budget.usedCreditsUsd : 0;
  const isPlatformCredits = providerBillingMode === "platform_credits";
  const canSetLimit = canEdit && (!isPlatformCredits || canFinanceAdmin);

  const handleSave = async () => {
    const val = Number(limit);
    if (!Number.isFinite(val) || val < 0) { toast.error("Invalid limit"); return; }
    setSaving(true);
    const res = await setProjectBudgetLimit(projectId, val, enabled);
    setSaving(false);
    if (!res.success) { toast.error(res.error || "Failed"); return; }
    toast.success(enabled ? `Limit: $${val.toFixed(2)}` : "Budget disabled");
    setEditing(false);
    router.refresh();
  };

  return (
    <div className="space-y-2">
      {budget?.isEnabled ? (
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-gray-400 dark:text-slate-500">
            ${budget.usedCreditsUsd.toFixed(2)} / ${budget.totalCreditsUsd.toFixed(2)}
          </span>
          <span className={`mono font-medium ${remaining <= 0 ? "text-rose-500" : "text-emerald-500"}`}>
            ${remaining.toFixed(2)} left
          </span>
        </div>
      ) : (
        <span className="text-[11px] text-gray-400 dark:text-slate-500">No limit</span>
      )}
      {canSetLimit && editing ? (
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-slate-400">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-3 w-3" />
            On
          </label>
          <input
            type="number" step="0.01" min="0" value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <button onClick={handleSave} disabled={saving}
            className="rounded bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            {saving ? "..." : "Save"}
          </button>
          <button onClick={() => setEditing(false)} className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
            Cancel
          </button>
        </div>
      ) : canEdit ? (
        <div className="flex items-center gap-1.5">
          {canSetLimit && (
            <button onClick={() => setEditing(true)}
              className="rounded border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:border-violet-400 hover:text-violet-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-violet-500 dark:hover:text-violet-400">
              Set limit
            </button>
          )}
          <AddCreditsButton
            projectId={projectId}
            externalOpen={creditsOpen}
            onExternalOpenChange={setCreditsOpen}
            allowDebit={canFinanceAdmin}
          />
          <button onClick={() => setCreditsOpen(true)}
            className="rounded border border-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500 hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400">
            Add credits
          </button>
        </div>
      ) : null}
    </div>
  );
}
