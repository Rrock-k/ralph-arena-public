"use client";

import { useState, useTransition } from "react";
import { archiveProposal, unarchiveProposal } from "@/app/actions/archive";

export function ArchiveButton({
  proposalId,
  isArchived,
}: {
  proposalId: string;
  isArchived: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = isArchived
        ? await unarchiveProposal(proposalId)
        : await archiveProposal(proposalId);
      if (!result.success) {
        setError(result.error ?? "Unknown error");
      }
    });
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:bg-slate-700/80 disabled:opacity-50"
      >
        {isPending
          ? isArchived
            ? "Restoring..."
            : "Archiving..."
          : isArchived
          ? "Unarchive"
          : "Archive"}
      </button>
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
