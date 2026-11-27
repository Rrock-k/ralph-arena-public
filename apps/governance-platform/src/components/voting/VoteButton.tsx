"use client";

import { useState, useTransition } from "react";
import { toggleVote } from "@/app/actions/votes";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { mapVoteErrorForPublic } from "@/lib/public-error-messages";

interface VoteButtonProps {
  proposalId: string;
  initialVoteCount: number;
  initialHasVoted: boolean;
  isAuthenticated: boolean;
}

export function VoteButton({
  proposalId,
  initialVoteCount,
  initialHasVoted,
  isAuthenticated,
}: VoteButtonProps) {
  const [voteCount, setVoteCount] = useState(initialVoteCount);
  const [hasVoted, setHasVoted] = useState(initialHasVoted);
  const [isPending, startTransition] = useTransition();

  const handleVote = async () => {
    if (!isAuthenticated) {
      toast.error("Sign in to vote");
      return;
    }

    startTransition(async () => {
      const result = await toggleVote(proposalId);

      if (result.success && result.voteCount !== undefined && result.hasVoted !== undefined) {
        setVoteCount(result.voteCount);
        setHasVoted(result.hasVoted);
        toast.success(result.hasVoted ? "Vote added" : "Vote removed");
      } else if (result.error) {
        // E-AUTH-003: stale session → auto sign-out and redirect to sign-in
        if (result.error.includes("E-AUTH-003")) {
          toast.error("Session expired — signing you out…");
          signOut({ callbackUrl: "/?session=expired" });
        } else {
          toast.error(mapVoteErrorForPublic(result.error));
        }
      }
    });
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        onClick={handleVote}
        disabled={isPending}
        className={`w-9 h-7 rounded-md border flex items-center justify-center text-sm cursor-pointer transition-all ${
          hasVoted
            ? "border-emerald-400 bg-emerald-500 text-white"
            : "border border-gray-300 bg-white text-gray-500 hover:border-emerald-400 hover:text-emerald-500 hover:bg-emerald-50"
        } disabled:opacity-50 disabled:cursor-not-allowed ${isPending ? 'animate-pulse' : ''}`}
        title={isAuthenticated ? (hasVoted ? "Remove vote" : "Upvote") : "Sign in to vote"}
        aria-label={`Vote count: ${voteCount}. ${hasVoted ? 'Remove your vote' : 'Add vote'}`}
      >
        &#9650;
      </button>
      <span className="mono text-sm font-bold text-gray-700">{voteCount}</span>
    </div>
  );
}
