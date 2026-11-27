"use client";

import { useState } from "react";

interface SpecVoteButtonsProps {
  netVotes: number;
  userVote: 1 | -1 | 0;
  onVote?: (value: 1 | -1 | 0) => void;
  disabled?: boolean;
  budgetExhausted?: boolean;
}

export function SpecVoteButtons({
  netVotes: initialNetVotes,
  userVote: initialUserVote,
  onVote,
  disabled = false,
  budgetExhausted = false,
}: SpecVoteButtonsProps) {
  const [netVotes, setNetVotes] = useState(initialNetVotes);
  const [userVote, setUserVote] = useState(initialUserVote);

  const handleVote = (value: 1 | -1) => {
    const newVote = userVote === value ? 0 : value;
    // Can't cast a new vote when budget is exhausted (removing is always ok)
    if (budgetExhausted && userVote === 0) return;
    const delta = newVote - userVote;
    setNetVotes((v) => v + delta);
    setUserVote(newVote);
    onVote?.(newVote);
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* Upvote */}
      <button
        onClick={() => handleVote(1)}
        disabled={disabled}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-all ${
          userVote === 1
            ? "bg-emerald-500/20 text-emerald-300"
            : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        aria-label="Upvote"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 3a1 1 0 01.707.293l5 5a1 1 0 01-1.414 1.414L10 5.414 5.707 9.707a1 1 0 01-1.414-1.414l5-5A1 1 0 0110 3z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Score */}
      <span
        className={`mono text-sm font-bold tabular-nums ${
          netVotes > 0
            ? "text-emerald-300"
            : netVotes < 0
              ? "text-rose-400"
              : "text-slate-500"
        }`}
      >
        {netVotes > 0 ? `+${netVotes}` : netVotes}
      </span>

      {/* Downvote */}
      <button
        onClick={() => handleVote(-1)}
        disabled={disabled}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-all ${
          userVote === -1
            ? "bg-rose-500/20 text-rose-400"
            : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        aria-label="Downvote"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 17a1 1 0 01-.707-.293l-5-5a1 1 0 011.414-1.414L10 14.586l4.293-4.293a1 1 0 011.414 1.414l-5 5A1 1 0 0110 17z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
