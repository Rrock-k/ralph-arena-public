"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  cleanupHetznerOrphans,
} from "@/app/actions/runtime-maintenance";

export function RuntimeMaintenancePanel() {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
            Runtime Maintenance
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Run explicit maintenance actions for orphaned Hetzner servers and SSH keys.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              startTransition(async () => {
                const result = await cleanupHetznerOrphans();
                if (result.success) toast.success(result.details || "Orphan cleanup completed");
                else toast.error(result.error || "Orphan cleanup failed");
              });
            }}
            disabled={isPending}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
          >
            {isPending ? "Working..." : "Cleanup Hetzner Orphans"}
          </button>
        </div>
      </div>
    </div>
  );
}
