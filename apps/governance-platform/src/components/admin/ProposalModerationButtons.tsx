"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { approveProposal, rejectProposal } from "@/app/actions/proposals";

interface ProposalModerationButtonsProps {
  proposalId: string;
  status: string;
}

export function ProposalModerationButtons({ proposalId, status }: ProposalModerationButtonsProps) {
  const [isPending, startTransition] = useTransition();

  if (status !== "PENDING_REVIEW") return null;

  function handleApprove() {
    startTransition(async () => {
      const result = await approveProposal(proposalId);
      if (result.success) {
        if ("finalized" in result && result.finalized) {
          toast.success(`Approved! ${result.projectsCreated} projects launched.`);
        } else {
          toast.success("Proposal approved");
        }
      } else {
        toast.error(result.error || "Failed to approve");
      }
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectProposal(proposalId);
      if (result.success) {
        toast.success("Proposal rejected");
      } else {
        toast.error(result.error || "Failed to reject");
      }
    });
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleApprove}
        disabled={isPending}
        className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
      >
        {isPending ? "..." : "Approve"}
      </button>
      <button
        onClick={handleReject}
        disabled={isPending}
        className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"
      >
        {isPending ? "..." : "Reject"}
      </button>
    </div>
  );
}
