"use client";

import { useState } from "react";
import { SpecVoteButtons } from "./SpecVoteButtons";
import type { SpecProposalData } from "./mock-data";

interface SpecProposalCardProps {
  proposal: SpecProposalData;
  onVote?: (proposalId: string, value: 1 | -1 | 0) => void;
  isAuthenticated?: boolean;
  threshold?: number;
  budgetExhausted?: boolean;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusStyles = {
  PROPOSED: "",
  ACCEPTED: "border-emerald-400/20 bg-emerald-500/[0.03]",
  REJECTED: "border-rose-400/20 bg-rose-500/[0.03] opacity-60",
};

export function SpecProposalCard({
  proposal,
  onVote,
  isAuthenticated = true,
  threshold = 2,
  budgetExhausted = false,
}: SpecProposalCardProps) {
  const [showInstructions, setShowInstructions] = useState(false);
  const aboveThreshold = proposal.netVotes >= threshold;

  return (
    <div
      className={`flex gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-white/15 ${statusStyles[proposal.status]}`}
    >
      {/* Vote column */}
      <SpecVoteButtons
        netVotes={proposal.netVotes}
        userVote={proposal.userVote}
        onVote={(v) => onVote?.(proposal.id, v)}
        disabled={!isAuthenticated || proposal.status !== "PROPOSED"}
        budgetExhausted={budgetExhausted}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h4 className="text-sm font-semibold text-slate-100 leading-snug">
            {proposal.title}
          </h4>
          <div className="flex shrink-0 items-center gap-2">
            {proposal.status === "ACCEPTED" && (
              <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                Accepted
              </span>
            )}
            {proposal.status === "REJECTED" && (
              <span className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-400">
                Rejected
              </span>
            )}
            {proposal.status === "PROPOSED" && aboveThreshold && (
              <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-500/5 px-2 py-0.5 text-[10px] font-semibold text-emerald-400/80">
                Above threshold
              </span>
            )}
          </div>
        </div>

        {/* Description — for voters */}
        <p className="text-sm text-slate-400 leading-relaxed">
          {proposal.description}
        </p>

        {/* Instructions toggle */}
        <button
          onClick={() => setShowInstructions((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-600 transition-colors hover:text-slate-400"
        >
          <svg
            className={`h-3 w-3 transition-transform ${showInstructions ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          Agent instructions
        </button>

        {showInstructions && (
          <div className="mt-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
            <p className="mono text-xs text-slate-500 leading-relaxed">
              {proposal.instructions}
            </p>
          </div>
        )}

        {/* Meta */}
        <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-600">
          <span>{proposal.creator.name}</span>
          <span>{timeAgo(proposal.createdAt)}</span>
          <span className="mono">
            {proposal.upvotes}↑ {proposal.downvotes}↓
          </span>
        </div>
      </div>
    </div>
  );
}
