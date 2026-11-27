"use client";

import { useState, useTransition } from "react";
import { archiveProject } from "@/app/actions/archive";

interface ArchiveProjectButtonProps {
  projectId: string;
}

export function ArchiveProjectButton({ projectId }: ArchiveProjectButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (archived) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
        Archived
      </span>
    );
  }

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }

    setError(null);
    setConfirming(false);
    startTransition(async () => {
      const result = await archiveProject(projectId);
      if (result.success) {
        setArchived(true);
      } else {
        setError(result.error ?? "Unknown error");
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-50 ${
          confirming
            ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
            : "border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
        }`}
      >
        {isPending ? "Archiving..." : confirming ? "Confirm Archive" : "Archive"}
      </button>
      {error && <span className="text-[11px] text-rose-600 dark:text-rose-300">{error}</span>}
    </div>
  );
}
