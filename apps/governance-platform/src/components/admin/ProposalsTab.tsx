"use client";

import { useState } from "react";
import Link from "next/link";
import { ProposalStatusBadge } from "@/components/proposals/ProposalStatusBadge";
import { ProposalModerationButtons } from "./ProposalModerationButtons";
import { LaunchButton } from "./LaunchButton";
import { ProposalContextMenu } from "./ProposalContextMenu";
import type { ProjectFacingAgentLoop } from "@/lib/project-facing-agent-loops";

interface ProposalsTabProps {
  proposals: any[];
  archivedProposals: any[];
  seasons: any[];
  tools: any[];
  agentLoops: ProjectFacingAgentLoop[];
  /** When set, clicking a proposal with projects selects the first project instead of navigating away. */
  onProjectSelect?: (projectId: string) => void;
}

export function ProposalsTab({ proposals, archivedProposals, seasons, tools, agentLoops, onProjectSelect }: ProposalsTabProps) {
  const [showArchived, setShowArchived] = useState(false);
  const seasonOptions = seasons.map((s: any) => ({ id: s.id, title: s.title, status: s.status }));

  const list = showArchived ? archivedProposals : proposals;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setShowArchived(false)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            !showArchived
              ? "bg-gray-900 text-white dark:bg-emerald-500 dark:text-slate-950"
              : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          Active ({proposals.length})
        </button>
        <button
          onClick={() => setShowArchived(true)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            showArchived
              ? "bg-gray-900 text-white dark:bg-emerald-500 dark:text-slate-950"
              : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          Archived ({archivedProposals.length})
        </button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {showArchived ? "No archived proposals." : "No proposals yet."}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((proposal: any) => (
            <div
              key={proposal.id}
              className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {onProjectSelect && proposal.projects?.[0] ? (
                      <button
                        onClick={() => onProjectSelect(proposal.projects[0].id)}
                        className="text-left text-sm font-medium text-gray-900 transition-colors hover:text-emerald-600 dark:text-slate-100 dark:hover:text-emerald-400"
                      >
                        {proposal.title}
                      </button>
                    ) : (
                      <Link
                        href={`/proposals/${proposal.id}`}
                        className="text-sm font-medium text-gray-900 transition-colors hover:text-emerald-600 dark:text-slate-100 dark:hover:text-emerald-400"
                      >
                        {proposal.title}
                      </Link>
                    )}
                    {proposal.status && proposal.status !== "PROPOSED" && (
                      <ProposalStatusBadge status={proposal.status} />
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 mono dark:text-slate-400">
                    <span>{proposal._count.votes} votes</span>
                    {showArchived ? (
                      <>
                        <span>Archived {new Date(proposal.archivedAt).toLocaleDateString()}</span>
                        {proposal.projects?.length > 0 && (
                          <span>{proposal.projects.length} project(s)</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span>{proposal._count.projects} project(s)</span>
                        <span>{new Date(proposal.createdAt).toLocaleDateString("en-US")}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!showArchived && (
                    <>
                      <ProposalModerationButtons proposalId={proposal.id} status={proposal.status} />
                      <LaunchButton proposalId={proposal.id} tools={tools} agentLoops={agentLoops} />
                    </>
                  )}
                  <ProposalContextMenu
                    proposalId={proposal.id}
                    proposal={{
                      title: proposal.title,
                      description: proposal.description ?? "",
                      spec: proposal.spec ?? "",
                      status: proposal.status,
                      seasonId: proposal.seasonId,
                    }}
                    seasons={seasonOptions}
                    isArchived={showArchived}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
