"use client";

import { Fragment, useState } from "react";
import { SeasonForm } from "./SeasonForm";
import { SeasonContextMenu } from "./SeasonContextMenu";
import { ProposalStatusBadge } from "@/components/proposals/ProposalStatusBadge";
import { ProposalModerationButtons } from "./ProposalModerationButtons";
import { LaunchButton } from "./LaunchButton";
import { ProposalContextMenu } from "./ProposalContextMenu";
import { getCurrentPhase } from "@/lib/seasons";
import Link from "next/link";
import type { ProjectFacingAgentLoop } from "@/lib/project-facing-agent-loops";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "border-gray-200 bg-gray-50 text-gray-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  COMPLETED: "border-cyan-200 bg-cyan-50 text-cyan-700",
  ARCHIVED: "border-gray-200 bg-gray-50 text-gray-500",
};

const PHASE_STYLES: Record<string, string> = {
  Open: "border-cyan-200 bg-cyan-50 text-cyan-700",
  Build: "border-amber-200 bg-amber-50 text-amber-700",
};

const PHASE_DOT: Record<string, string> = {
  Open: "bg-cyan-500",
  Build: "bg-amber-500",
};

function formatDateTime(date: Date | null) {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface SeasonsTabProps {
  seasons: any[];
  tools: any[];
  agentLoops: ProjectFacingAgentLoop[];
}

export function SeasonsTab({ seasons, tools, agentLoops }: SeasonsTabProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const seasonOptions = seasons.map((s: any) => ({ id: s.id, title: s.title, status: s.status }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {seasons.length} season{seasons.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white transition-all hover:bg-gray-800"
        >
          Create Season
        </button>
      </div>

      {seasons.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          No seasons yet. Create your first season to structure the platform rhythm.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3">Season</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Open start</th>
                <th className="px-4 py-3">Build start</th>
                <th className="px-4 py-3">Deadline</th>
                <th className="px-4 py-3 text-right">Proposals</th>
                <th className="px-4 py-3 text-right">Top</th>
                <th className="px-4 py-3">Config</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {seasons.map((season: any) => {
                const phase = getCurrentPhase(season);
                const isExpanded = expandedId === season.id;
                return (
                  <Fragment key={season.id}>
                    <tr
                      className="border-b border-gray-50 last:border-0 transition-colors hover:bg-gray-50/50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{season.title}</div>
                        {season.description && (
                          <div className="mt-0.5 line-clamp-1 text-xs text-gray-400">{season.description}</div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLES[season.status] || STATUS_STYLES.DRAFT}`}>
                            {season.status}
                          </span>
                          {phase && (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${PHASE_STYLES[phase]}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${PHASE_DOT[phase]} animate-pulse`} />
                              {phase}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                        {formatDateTime(season.submissionStart)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                        {formatDateTime(season.buildStart)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                        {formatDateTime(season.buildDeadline)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : season.id)}
                          className="inline-flex items-center gap-1 font-mono text-xs text-gray-500 hover:text-gray-900 transition-colors"
                        >
                          {season._count.proposals}
                          <svg
                            className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-500">
                        {season.maxWinners}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          {season.buildConfigs?.length > 0 && (
                            <span className="text-xs text-gray-500">
                              {season.buildConfigs.length} agent{season.buildConfigs.length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {season.requiresModeration && (
                            <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-600">
                              moderated
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <SeasonContextMenu season={season} />
                      </td>
                    </tr>

                    {/* Expanded proposals row */}
                    {isExpanded && (
                      <tr key={`${season.id}-proposals`}>
                        <td colSpan={9} className="px-4 pb-4">
                          <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                            {(!season.proposals || season.proposals.length === 0) ? (
                              <p className="py-2 text-center text-xs text-gray-400">
                                No proposals in this season.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {season.proposals.map((proposal: any) => (
                                  <div
                                    key={proposal.id}
                                    className="rounded-xl border border-gray-200 bg-white p-3"
                                  >
                                    <div className="flex items-start gap-4">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <Link
                                            href={`/proposals/${proposal.id}`}
                                            className="text-sm font-medium text-gray-900 hover:text-emerald-600 transition-colors"
                                          >
                                            {proposal.title}
                                          </Link>
                                          {proposal.status && proposal.status !== "PROPOSED" && (
                                            <ProposalStatusBadge status={proposal.status} />
                                          )}
                                        </div>
                                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 mono">
                                          <span>{proposal._count.votes} votes</span>
                                          <span>{proposal._count.projects} project(s)</span>
                                          <span>{new Date(proposal.createdAt).toLocaleDateString("en-US")}</span>
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <ProposalModerationButtons proposalId={proposal.id} status={proposal.status} />
                                        <LaunchButton proposalId={proposal.id} tools={tools} agentLoops={agentLoops} />
                                        <ProposalContextMenu
                                          proposalId={proposal.id}
                                          proposal={{
                                            title: proposal.title,
                                            description: proposal.description,
                                            spec: proposal.spec,
                                            status: proposal.status,
                                            seasonId: proposal.seasonId,
                                          }}
                                          seasons={seasonOptions}
                                          isArchived={false}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SeasonForm open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
