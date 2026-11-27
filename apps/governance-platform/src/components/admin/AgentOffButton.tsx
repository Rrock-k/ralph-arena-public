"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAgentIntent } from "@/app/actions/agent-intent";
import { toast } from "sonner";
import { Loader2, Pause } from "lucide-react";

interface AgentOffButtonProps {
  projectId: string;
  pendingState?: boolean;
}

export function AgentOffButton({ projectId, pendingState = false }: AgentOffButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleAgentOff() {
    startTransition(async () => {
      const result = await setAgentIntent(projectId, "OFF");
      if (result.success) {
        toast.success("Agent off");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed");
      }
    });
  }

  const isBusy = isPending || pendingState;
  const title = isPending ? "Stopping agent..." : pendingState ? "Agent stop requested" : "Agent off";

  return (
    <button
      type="button"
      disabled={isBusy}
      onClick={handleAgentOff}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-white text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-500/10"
      title={title}
      aria-label={title}
    >
      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
    </button>
  );
}
