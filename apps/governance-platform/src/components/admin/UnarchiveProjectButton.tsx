"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { unarchiveProject } from "@/app/actions/archive";

interface UnarchiveProjectButtonProps {
  projectId: string;
}

export function UnarchiveProjectButton({ projectId }: UnarchiveProjectButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleUnarchive() {
    startTransition(async () => {
      const result = await unarchiveProject(projectId);
      if (!result.success) {
        toast.error(result.error ?? "Failed");
        return;
      }
      toast.success("Unarchived");
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleUnarchive}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-white text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-500/10"
      title="Unarchive project"
      aria-label="Unarchive project"
    >
      <RotateCcw className="h-4 w-4" />
    </button>
  );
}
