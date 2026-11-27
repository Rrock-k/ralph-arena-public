/**
 * PreviewCard — Clean light card for active proposals.
 * Shows live preview in a clean frame with stage indicator.
 *
 * The iframe renders at full monitor resolution (1280x800) and is
 * CSS-scaled down to fit the card — giving a "miniature monitor" effect.
 */
"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import type { ProposalCardProps } from "./types";
import {
  getBudgetDisplayData,
  getPreviewStage,
  getPublicRunMessage,
  getProjectDisplayStatus,
} from "./types";
import { formatAgentLabel } from "@/lib/agent-labels-shared";
import { BackendBadgeCompact } from "@/components/admin/BackendBadge";
import { PreviewIframe } from "@/components/preview/PreviewIframe";

const MONITOR_W = 1280;
const MONITOR_H = 800;
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

function formatFullDate(date: Date): string {
  return FULL_DATE_FORMATTER.format(new Date(date));
}

/* Light-theme stage badge colors */
function getLightStageStyle(stage: string) {
  if (stage === "paused") {
    return {
      dot: "bg-amber-500",
      badge: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  if (stage === "starting" || stage === "building") {
    return {
      dot: "bg-amber-400",
      badge: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  return {
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
}

/** Compact runner badge */
function getRunnerBadge(agentImpl?: string | null): {
  code: string;
  label: string;
} {
  if (agentImpl === "direct") return { code: "SL", label: "Simple Loop" };
  if (agentImpl === "dummy") return { code: "T", label: "Test" };
  return { code: "RE", label: "Ralph Extended" };
}

export function PreviewCard({
  proposal,
  project: projectOverride,
  detailHrefOverride,
  onCardClick,
  showBudget = false,
  showBackendBadge = false,
  serverStage,
}: ProposalCardProps) {
  const project = projectOverride ?? proposal.projects?.[0];
  const previewUrl = project?.previewUrl ?? null;
  const stage = serverStage ?? getPreviewStage(proposal, project);
  const lightStage = stage ? getLightStageStyle(stage) : null;
  const detailHref =
    detailHrefOverride ??
    (project ? `/projects/${project.id}` : `/proposals/${proposal.id}`);
  const runner = project ? getRunnerBadge(project.agentImpl) : null;
  const budgetData = getBudgetDisplayData(project, showBudget);

  const displayStatus = project ? getProjectDisplayStatus(project) : null;
  const publicStatusMessage = getPublicRunMessage(displayStatus);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [ageLabel, setAgeLabel] = useState("");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / MONITOR_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!project) return;

    const update = () => setAgeLabel(timeAgo(project.createdAt));
    update();
    const intervalId = window.setInterval(update, 60_000);
    return () => window.clearInterval(intervalId);
  }, [project]);

  return (
    <article className="group flex flex-col rounded-xl border border-gray-200 bg-white transition-all hover:border-gray-300 hover:shadow-lg">
      {/* Header — title, badges, and compact project meta */}
      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="flex items-center gap-2">
          {onCardClick ? (
            <button
              type="button"
              onClick={onCardClick}
              className="min-w-0 flex-1 text-left"
            >
              <h3 className="truncate text-sm font-bold text-gray-900 transition-colors group-hover:text-emerald-600">
                {proposal.title}
              </h3>
            </button>
          ) : (
            <Link href={detailHref} className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-bold text-gray-900 transition-colors group-hover:text-emerald-600">
                {proposal.title}
              </h3>
            </Link>
          )}
          {lightStage && (
            <div
              className={`relative -mr-0.5 flex items-center gap-1.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${lightStage.badge} ${stage === "starting" || stage === "building" ? "animate-pulse" : ""} ${publicStatusMessage ? "group/status cursor-default" : ""}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${lightStage.dot}`} />
              {stage}
              {publicStatusMessage && (
                <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 whitespace-nowrap rounded border border-gray-200 bg-white px-2 py-1 text-[10px] text-gray-600 shadow-sm opacity-0 transition-opacity group-hover/status:opacity-100">
                  {publicStatusMessage}
                </span>
              )}
            </div>
          )}
        </div>
        {project && (
          <p className="mt-1 flex items-center gap-1.5 text-[10px] leading-none text-gray-400 mono">
            <span className="truncate">
              {formatAgentLabel(
                project.agent,
                project.agentImpl,
                project.model,
              )}
            </span>
            {runner && (
              <span className="relative shrink-0 group/tip">
                <span className="rounded border border-gray-300/60 px-1 py-px font-bold cursor-default transition-colors hover:text-gray-600">
                  {runner.code}
                </span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 whitespace-nowrap rounded border border-gray-200 bg-white px-2 py-1 text-gray-600 shadow-sm opacity-0 pointer-events-none transition-opacity group-hover/tip:opacity-100 z-10">
                  {runner.label}
                </span>
              </span>
            )}
            {showBackendBadge && project.runnerBackend === "vps" && (
              <BackendBadgeCompact backend={project.runnerBackend} />
            )}
            <span className="relative ml-auto shrink-0 group/age">
              <span className="cursor-default" suppressHydrationWarning>
                {ageLabel}
              </span>
              <span className="absolute bottom-full right-0 mb-1.5 whitespace-nowrap rounded border border-gray-200 bg-white px-2 py-1 text-gray-600 shadow-sm opacity-0 pointer-events-none transition-opacity group-hover/age:opacity-100 z-10">
                {formatFullDate(project.createdAt)}
              </span>
            </span>
          </p>
        )}
      </div>

      {/* Preview frame */}
      <Link href={detailHref} className="mt-2 block">
        <div className="relative overflow-hidden">
          <div
            ref={containerRef}
            className="relative aspect-[16/10] bg-gray-100 overflow-hidden"
          >
            {previewUrl ? (
              <PreviewIframe
                previewUrl={previewUrl}
                proposalTitle={proposal.title}
                projectId={project?.id}
                visibility={project?.visibility}
                iframeClassName="border-0 pointer-events-none origin-top-left"
                iframeStyle={{
                  width: MONITOR_W,
                  height: MONITOR_H,
                  transform: `scale(${scale})`,
                }}
                fallbackClassName="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-gray-400"
                loading="lazy"
              />
            ) : stage === "live" || stage === "paused" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-400">
                <svg
                  className="h-8 w-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {stage === "live" ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  )}
                </svg>
                <span className="text-xs">
                  {stage === "live" ? "No preview" : "Paused"}
                </span>
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <div className="h-6 w-6 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />
              </div>
            )}

            {/* Hover CTA */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-300 group-hover:bg-black/20">
              <span className="text-sm font-semibold text-white opacity-0 transition-all duration-300 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0">
                {project ? "Open Project" : "Open Proposal"} &#8599;
              </span>
            </div>
          </div>
        </div>
      </Link>

      {/* Footer — description + budget bar */}
      <div className="px-3 pb-3 pt-2.5 sm:px-4">
        <p className="line-clamp-2 text-xs leading-relaxed text-gray-500">
          {proposal.description}
        </p>

        {budgetData.hasBudget && (
          <div
            className="relative mt-2 flex items-center gap-2.5 group/budget"
            tabIndex={0}
          >
            <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-gray-200/60">
              <div
                className={`h-full rounded-full ${budgetData.budgetBarColor} transition-all`}
                style={{ width: `${budgetData.budgetRemainingPct}%` }}
              />
            </div>
            <span className="mono shrink-0 text-[10px] leading-none text-gray-400">
              ${budgetData.budgetRemaining.toFixed(2)}
            </span>
            <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 whitespace-nowrap rounded border border-gray-200 bg-white px-2 py-1 text-[10px] text-gray-600 shadow-sm opacity-0 transition-opacity group-hover/budget:opacity-100 group-focus-within/budget:opacity-100">
              Used ${budgetData.budgetUsed.toFixed(2)} / $
              {budgetData.budgetTotal.toFixed(2)} (
              {budgetData.budgetUsagePct.toFixed(0)}%)
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
