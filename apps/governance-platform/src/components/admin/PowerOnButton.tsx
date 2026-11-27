"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";
import { toast } from "sonner";
import { setPowerIntent } from "@/app/actions/power-intent";

interface PowerOnButtonProps {
  projectId: string;
}

export function PowerOnButton({ projectId }: PowerOnButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handlePowerOn() {
    startTransition(async () => {
      const result = await setPowerIntent(projectId, "ON");
      if (!result.success) {
        toast.error(result.error ?? "Failed");
        return;
      }
      toast.success("App start requested");
      router.refresh();
      window.setTimeout(() => router.refresh(), 4000);
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handlePowerOn}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-200 bg-white text-cyan-700 transition-colors hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-500/30 dark:bg-slate-900 dark:text-cyan-300 dark:hover:bg-cyan-500/10"
      title="App on"
      aria-label="App on"
    >
      <Power className="h-4 w-4" />
    </button>
  );
}
