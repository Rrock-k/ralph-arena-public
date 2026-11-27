import Link from "next/link";
import { VoteButton } from "@/components/voting/VoteButton";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";
import { ProposalStatusBadge } from "@/components/proposals/ProposalStatusBadge";

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface ProposalListProps {
  proposals: ProposalWithVotes[];
  isAuthenticated: boolean;
  showSeasonBadge?: boolean;
}

export function ProposalList({ proposals, isAuthenticated, showSeasonBadge = false }: ProposalListProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {proposals.map((proposal) => {
        const hasVoted = proposal.votes?.length > 0;
        return (
          <div
            key={proposal.id}
            id={`proposal-${proposal.id}`}
            className="grid grid-cols-[48px_1fr] items-center gap-3 border-b border-gray-100 px-6 py-4 transition hover:bg-gray-50 sm:grid-cols-[48px_1fr_auto] sm:gap-5"
          >
            <VoteButton
              proposalId={proposal.id}
              initialVoteCount={proposal._count.votes}
              initialHasVoted={hasVoted}
              isAuthenticated={isAuthenticated}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/proposals/${proposal.id}`}
                  className="truncate text-[15px] font-bold text-gray-950 hover:underline"
                >
                  {proposal.title}
                </Link>
                {showSeasonBadge && proposal.season && (
                  <span className="shrink-0 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                    {proposal.season.title}
                  </span>
                )}
                {proposal.status && proposal.status !== "PROPOSED" && (
                  <ProposalStatusBadge status={proposal.status} />
                )}
              </div>
              {proposal.description && (
                <div className="truncate text-sm text-gray-400">
                  {proposal.description.length > 120
                    ? proposal.description.slice(0, 120) + "..."
                    : proposal.description}
                </div>
              )}
            </div>
            <span className="hidden text-sm text-gray-400 sm:inline-block">
              {timeAgo(new Date(proposal.createdAt))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
