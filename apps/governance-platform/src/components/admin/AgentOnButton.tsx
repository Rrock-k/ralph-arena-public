"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { setAgentIntent } from "@/app/actions/agent-intent";
import { getLoopActionBlockMessageFromState } from "@/lib/loop-support";

interface AgentOnButtonProps {
  projectId: string;
  loopRuntime?: string | null;
  loopSupportStatus?: "supported" | "upgrade-required" | "unsupported" | null;
  agentStartAllowed?: boolean;
}

export function AgentOnButton({
  projectId,
  loopRuntime,
  loopSupportStatus,
  agentStartAllowed,
}: AgentOnButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const blockReason = getLoopActionBlockMessageFromState({
    loopIdentity: loopRuntime,
    supportStatus: loopSupportStatus,
    agentStartAllowed,
  }, "agent_on");

  function handleAgentOn() {
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    startTransition(async () => {
      const result = await setAgentIntent(projectId, "ON");
      if (!result.success) {
        toast.error(result.error ?? "Failed");
        return;
      }
      toast.success("Agent on");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      disabled={isPending || Boolean(blockReason)}
      onClick={handleAgentOn}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
      title={blockReason ?? "Agent on"}
      aria-label={blockReason ?? "Agent on"}
    >
      <Play className="h-4 w-4" />
    </button>
  );
}
