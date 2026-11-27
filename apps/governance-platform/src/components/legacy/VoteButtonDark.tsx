/**
 * VoteButtonDark — Dark neon theme vote button.
 * Used by legacy routes (/old, /retro).
 */
"use client";

import { useState, useTransition } from "react";
import { toggleVote } from "@/app/actions/votes";
import { toast } from "sonner";

interface VoteButtonDarkProps {
  proposalId: string;
  initialVoteCount: number;
  initialHasVoted: boolean;
  isAuthenticated: boolean;
}

export function VoteButtonDark({
  proposalId,
  initialVoteCount,
  initialHasVoted,
  isAuthenticated,
}: VoteButtonDarkProps) {
  const [voteCount, setVoteCount] = useState(initialVoteCount);
  const [hasVoted, setHasVoted] = useState(initialHasVoted);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleVote = async () => {
    if (!isAuthenticated) {
      toast.error("You must be signed in to vote");
      setError("You must be signed in to vote");
      return;
    }

    setError("");

    startTransition(async () => {
      const result = await toggleVote(proposalId);

      if (result.success && result.voteCount !== undefined && result.hasVoted !== undefined) {
        setVoteCount(result.voteCount);
        setHasVoted(result.hasVoted);
        toast.success(result.hasVoted ? "Vote added" : "Vote removed");
      } else if (result.error) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleVote}
        disabled={isPending}
        className={`vote-btn flex items-center gap-1.5 sm:gap-2 rounded-lg border px-3 py-1.5 font-semibold transition-all sm:px-4 sm:py-2 ${
          hasVoted
            ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-300 shadow-sm shadow-emerald-500/20 hover:bg-emerald-500/25"
            : "border-white/12 bg-white/[0.03] text-slate-300 hover:border-emerald-400/20 hover:bg-emerald-500/10 hover:text-emerald-300"
        } disabled:opacity-50 disabled:cursor-not-allowed ${isPending ? "animate-pulse" : ""}`}
        title={isAuthenticated ? (hasVoted ? "Remove vote" : "Upvote") : "Sign in to vote"}
        aria-label={`Vote count: ${voteCount}. ${hasVoted ? "Remove your vote" : "Add vote"}`}
      >
        <svg
          className="w-4 h-4 sm:w-5 sm:h-5"
          fill="currentColor"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
        <span className="mono text-sm sm:text-base">{voteCount}</span>
      </button>
      {error && (
        <span className="text-xs text-rose-300 sm:text-sm">{error}</span>
      )}
    </div>
  );
}
