/**
 * ProposalCardDark — Dark neon theme proposal card.
 * Used by /old and /retro legacy routes.
 */
import Link from "next/link";
import { VoteButtonDark } from "./VoteButtonDark";
import type { ProposalWithVotes } from "@/components/ui/project-card/types";
import { getStatusClasses } from "@/lib/status-classes";
import { getDisplayStatus } from "@/lib/display-status";

export function formatShortDate(date: Date) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProposalCardDark({
  proposal,
  isAuthenticated,
  userId,
}: {
  proposal: ProposalWithVotes;
  isAuthenticated: boolean;
  userId?: string;
}) {
  const hasVoted = userId ? proposal.votes.some((v) => v.userId === userId) : false;
  const voteCount = proposal._count.votes;
  const project = proposal.projects?.[0];
  const projectDisplayStatus = project ? getDisplayStatus(project) : null;
  const canVote = !project || projectDisplayStatus !== "LIVE";
  const isBuilding = projectDisplayStatus === "BUILDING";
  const isCancelRequested = false; // RA-192: cancelRequested removed, derive from component state

  return (
    <article className="glow-card flex h-full flex-col rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/proposals/${proposal.id}`} className="group">
            <h3 className="line-clamp-2 text-xl font-bold text-slate-100 transition-colors group-hover:text-cyan-300">
              {proposal.title}
            </h3>
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClasses(
                proposal.status
              )}`}
            >
              {proposal.status}
            </span>
            {proposal.archivedAt && (
              <span className="mono inline-flex rounded-full border border-slate-500/25 bg-slate-500/10 px-2.5 py-1 text-[11px] font-semibold text-slate-400">
                ARCHIVED
              </span>
            )}
            {isBuilding && !isCancelRequested && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                Agent building...
              </span>
            )}
            {isCancelRequested && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-300/80">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                Cancel requested
              </span>
            )}
          </div>
        </div>
        {canVote ? (
          <VoteButtonDark
            proposalId={proposal.id}
            initialVoteCount={voteCount}
            initialHasVoted={hasVoted}
            isAuthenticated={isAuthenticated}
          />
        ) : (
          <div className="rounded-lg border border-white/12 bg-white/[0.03] px-3 py-1.5 text-right">
            <div className="mono text-base font-semibold text-slate-200">{voteCount}</div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Votes locked</div>
          </div>
        )}
      </div>

      <p className="line-clamp-3 mt-4 flex-1 text-sm leading-relaxed text-slate-300">{proposal.description}</p>

      {project && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClasses(
                projectDisplayStatus!
              )}`}
            >
              {projectDisplayStatus}
            </span>
            <span className="mono text-[11px] text-slate-500">
              {formatShortDate(project.createdAt)}
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500 sm:text-sm">
        <span className="mono">{formatShortDate(proposal.createdAt)}</span>
        <span className="mono text-slate-400">{voteCount} votes</span>
      </div>
    </article>
  );
}
