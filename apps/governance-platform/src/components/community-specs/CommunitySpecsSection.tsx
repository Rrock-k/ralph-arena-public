"use client";

import { SpecBadge } from "./SpecBadge";
import { SpecProposalCard } from "./SpecProposalCard";
import { SpecWindowBanner } from "./SpecWindowBanner";
import { SubmitSpecForm } from "./SubmitSpecForm";
import { VoteBudgetPill } from "./VoteBudgetPill";
import type {
  SpecProposalData,
  SpecData,
  SpecWindowState,
  VoteBudget,
} from "./mock-data";

interface CommunitySpecsSectionProps {
  specs: SpecData[];
  proposals: SpecProposalData[];
  window: SpecWindowState;
  voteBudget?: VoteBudget;
  isAuthenticated?: boolean;
}

export function CommunitySpecsSection({
  specs,
  proposals,
  window: specWindow,
  voteBudget,
  isAuthenticated = true,
}: CommunitySpecsSectionProps) {
  const activeProposals = proposals
    .filter((p) => p.status === "PROPOSED")
    .sort((a, b) => b.netVotes - a.netVotes);
  const acceptedProposals = proposals.filter((p) => p.status === "ACCEPTED");
  const rejectedProposals = proposals.filter((p) => p.status === "REJECTED");

  const communitySpecs = specs.filter((s) => s.addedBy === "community");
  const budgetExhausted = voteBudget
    ? voteBudget.used >= voteBudget.max
    : false;
  const hasAnyContent =
    activeProposals.length > 0 ||
    acceptedProposals.length > 0 ||
    communitySpecs.length > 0 ||
    specWindow.status !== "closed";

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-100 sm:text-2xl">
          Community Specs
        </h2>
        <div className="flex items-center gap-3">
          {communitySpecs.length > 0 && (
            <span className="text-xs text-slate-500">
              {communitySpecs.length} accepted
            </span>
          )}
          {voteBudget && isAuthenticated && specWindow.status === "open" && (
            <VoteBudgetPill budget={voteBudget} />
          )}
        </div>
      </div>

      {/* Window status banner */}
      <SpecWindowBanner window={specWindow} />

      {/* Accepted community specs (already part of the project) */}
      {communitySpecs.length > 0 && (
        <div className="space-y-2">
          {communitySpecs.map((spec) => (
            <div
              key={spec.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  {spec.title && (
                    <h4 className="text-sm font-semibold text-slate-100">
                      {spec.title}
                    </h4>
                  )}
                  <SpecBadge
                    addedBy={spec.addedBy}
                    author={spec.creator?.name}
                  />
                </div>
                <span className="shrink-0 text-xs text-slate-500 mono">
                  {new Date(spec.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                {spec.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Submit form (only when window is open) */}
      {specWindow.status === "open" && (
        <SubmitSpecForm
          disabled={!isAuthenticated}
          onSubmit={(data) =>
            console.log("[mock] submit spec proposal:", data)
          }
        />
      )}

      {/* Active proposals (voting in progress) */}
      {activeProposals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-400">
            Proposals — vote for the ones you want
          </h3>
          {activeProposals.map((p) => (
            <SpecProposalCard
              key={p.id}
              proposal={p}
              isAuthenticated={isAuthenticated}
              threshold={specWindow.specVoteThreshold}
              budgetExhausted={budgetExhausted}
            />
          ))}
        </div>
      )}

      {/* Previously accepted proposals (from voting) */}
      {acceptedProposals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-400">
            Accepted this round
          </h3>
          {acceptedProposals.map((p) => (
            <SpecProposalCard
              key={p.id}
              proposal={p}
              isAuthenticated={isAuthenticated}
              threshold={specWindow.specVoteThreshold}
            />
          ))}
        </div>
      )}

      {/* Rejected (collapsed) */}
      {rejectedProposals.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-slate-600 hover:text-slate-400 transition-colors">
            {rejectedProposals.length} rejected proposal
            {rejectedProposals.length !== 1 ? "s" : ""}
          </summary>
          <div className="mt-2 space-y-2">
            {rejectedProposals.map((p) => (
              <SpecProposalCard
                key={p.id}
                proposal={p}
                isAuthenticated={isAuthenticated}
                threshold={specWindow.specVoteThreshold}
              />
            ))}
          </div>
        </details>
      )}

      {/* Empty state */}
      {!hasAnyContent && (
        <div className="rounded-xl border border-white/5 bg-white/[0.01] px-4 py-8 text-center">
          <p className="text-sm text-slate-600">
            Community spec proposals will appear here when a spec window opens.
          </p>
        </div>
      )}
    </div>
  );
}
