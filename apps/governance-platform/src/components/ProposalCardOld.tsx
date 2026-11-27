import Link from "next/link";
import { VoteButton } from "@/components/voting/VoteButton";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";
import {
  getProjectDisplayStatus,
  getPublicRunMessage,
} from "@/components/ui/project-card/types";
import { getStatusClasses } from "@/lib/status-classes";
import { isCancelInFlight } from "@/lib/display-status";

export type { ProposalWithVotes };

export function formatShortDate(date: Date) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const getRunStatusClasses = getStatusClasses;

export function ProposalCardOld({
  proposal,
  isAuthenticated,
  userId,
  isAdmin = false,
}: {
  proposal: ProposalWithVotes;
  isAuthenticated: boolean;
  userId?: string;
  isAdmin?: boolean;
}) {
  const hasVoted = userId
    ? proposal.votes.some((v) => v.userId === userId)
    : false;
  const voteCount = proposal._count.votes;
  const project = proposal.projects?.[0];
  const projectDisplayStatus = getProjectDisplayStatus(project);
  const canVote = !project || projectDisplayStatus !== "LIVE";
  const isBuilding = projectDisplayStatus === "BUILDING";
  const isCancelRequested = project ? isCancelInFlight(project) : false;
  const publicRunMessage = getPublicRunMessage(projectDisplayStatus);

  return (
    <article className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/proposals/${proposal.id}`} className="group">
            <h3 className="line-clamp-2 text-base font-bold text-gray-900 transition-colors group-hover:text-emerald-600">
              {proposal.title}
            </h3>
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClasses(
                proposal.status,
              )}`}
            >
              {proposal.status}
            </span>
            {proposal.archivedAt && (
              <span className="mono inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-500">
                ARCHIVED
              </span>
            )}
            {isBuilding && !isCancelRequested && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-600">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                Agent building...
              </span>
            )}
            {isCancelRequested && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-600">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                Cancel requested
              </span>
            )}
          </div>
        </div>
        {canVote ? (
          <VoteButton
            proposalId={proposal.id}
            initialVoteCount={voteCount}
            initialHasVoted={hasVoted}
            isAuthenticated={isAuthenticated}
          />
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-right">
            <div className="mono text-base font-semibold text-gray-900">
              {voteCount}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">
              Votes locked
            </div>
          </div>
        )}
      </div>

      <p className="line-clamp-3 mt-4 flex-1 text-sm leading-relaxed text-gray-600">
        {proposal.description}
      </p>

      {project && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getRunStatusClasses(
                projectDisplayStatus!,
              )}`}
            >
              {projectDisplayStatus}
            </span>
            <span className="mono text-[11px] text-gray-500">
              {formatShortDate(project.createdAt)}
            </span>
          </div>
          {publicRunMessage && (
            <p className="mt-2 line-clamp-2 text-xs text-gray-600">
              {publicRunMessage}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-gray-500 sm:text-sm">
        <span className="mono">{formatShortDate(proposal.createdAt)}</span>
        <span className="mono text-gray-600">{voteCount} votes</span>
      </div>
    </article>
  );
}
