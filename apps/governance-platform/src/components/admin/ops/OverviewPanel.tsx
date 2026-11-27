"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OpsProject } from "./OpsDashboard";
import { BuildProgress } from "@/components/BuildProgress";
import { getStatusClasses as statusClasses } from "@/lib/status-classes";
import { getProjectDescription, getProjectName } from "@/lib/project-identity";
import { StatusBadge } from "../StatusBadge";
import { hasLiveAgentLoop } from "@/lib/agent-loop-activity";
import { getAppComponent, getOpsDisplayStatus } from "@/lib/operator-display";
import {
  buildRunLogActivity,
  formatRunLogGroupTitle,
  type RunLogActivity,
} from "@/lib/run-log-activity";

// RA-240: Layer color coding — amber=project, cyan=runtime, lime=agent
const LAYER_STYLES = {
  project: "border-l-amber-400 text-amber-300/80",
  runtime: "border-l-cyan-400 text-cyan-300/80",
  agent: "border-l-lime-400 text-lime-300/80",
} as const;

const LAYER_CARD_BORDER = {
  project: "border-l-2 border-l-amber-400/40",
  runtime: "border-l-2 border-l-cyan-400/40",
  agent: "border-l-2 border-l-lime-400/40",
} as const;

function LayerChip({
  layer,
  label,
}: {
  layer: keyof typeof LAYER_STYLES;
  label: string;
}) {
  return (
    <span
      className={`mono inline-flex border-l-2 pl-1.5 text-[10px] ${LAYER_STYLES[layer]}`}
    >
      {label}
    </span>
  );
}

function formatCost(costUsd: number | null | undefined): string {
  if (costUsd == null || costUsd === 0) return "$0.00";
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

function formatTokens(count: number | null | undefined): string {
  if (count == null || count === 0) return "0";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`;
  return String(count);
}

export function OverviewPanel({ project }: { project: OpsProject }) {
  const app = getAppComponent(project);
  const displayStatus = getOpsDisplayStatus(project);
  const hasLiveLoop = hasLiveAgentLoop(project);
  const fallbackActivity = useMemo(
    () => buildRunLogActivity(project.runLogs, { maxGroups: 10 }),
    [project.runLogs],
  );
  const [remoteActivity, setRemoteActivity] = useState<RunLogActivity | null>(null);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const runLogActivity = remoteActivity ?? fallbackActivity;

  useEffect(() => {
    const controller = new AbortController();
    setRemoteActivity(null);
    setExpandedGroups({});
    setIsLoadingActivity(true);

    fetch(`/api/admin/projects/${encodeURIComponent(project.id)}/run-logs?limit=200&groups=12`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json() as { activity?: RunLogActivity };
        return payload.activity ?? null;
      })
      .then((activity) => {
        if (activity) setRemoteActivity(activity);
      })
      .catch((error) => {
        if ((error as { name?: string }).name === "AbortError") return;
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingActivity(false);
      });

    return () => controller.abort();
  }, [project.id]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
          {getProjectName(project)}
        </h2>
        {getProjectDescription(project) && (
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            {getProjectDescription(project)}
          </p>
        )}
      </div>

      {/* RA-240: Agent layer — status + progress */}
      <Card className={LAYER_CARD_BORDER.agent}>
        <SectionTitle>Agent</SectionTitle>
        <div className="flex items-center gap-3">
          <StatusBadge
            status={displayStatus}
            className="mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            title={undefined}
          />
          <span className="mono text-[11px] text-gray-400 dark:text-slate-500">
            {new Date(project.createdAt).toLocaleString()}
          </span>
          <span className="mono text-[11px] font-medium text-violet-600">
            {formatCost(project.estimatedCostUsd)}
          </span>
        </div>
        {app && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <LayerChip layer="agent" label={app.agentState ?? "—"} />
            {app.lastOutcome && (
              <LayerChip layer="agent" label={app.lastOutcome} />
            )}
            {(app.blockers?.length ?? 0) > 0 && (
              <LayerChip
                layer="agent"
                label={(app.blockers ?? []).join(", ")}
              />
            )}
          </div>
        )}
        {hasLiveLoop && project.progressJson && (
          <div className="mt-2">
            <BuildProgress progressJson={project.progressJson} />
          </div>
        )}
      </Card>

      {/* RA-240: Runtime layer */}
      {app && (
        <Card className={LAYER_CARD_BORDER.runtime}>
          <SectionTitle>Runtime</SectionTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <LayerChip
              layer="runtime"
              label={`${app.powerIntent === "ON" ? "ON" : "OFF"} · ${app.runtimeState ?? "ABSENT"}`}
            />
          </div>
        </Card>
      )}

      {/* RA-240: Project layer — usage + budget */}
      <Card className={LAYER_CARD_BORDER.project}>
        <SectionTitle>Usage</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Metric
            label="Input tokens"
            value={formatTokens(project.inputTokens)}
          />
          <Metric
            label="Output tokens"
            value={formatTokens(project.outputTokens)}
          />
          <Metric
            label="Est. cost"
            value={formatCost(project.estimatedCostUsd)}
            highlight
          />
        </div>
      </Card>

      {project.budget?.isEnabled && (
        <Card className={LAYER_CARD_BORDER.project}>
          <SectionTitle>Budget</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            <Metric
              label="Total"
              value={`$${project.budget.totalCreditsUsd.toFixed(2)}`}
            />
            <Metric
              label="Used"
              value={`$${project.budget.usedCreditsUsd.toFixed(2)}`}
            />
            <Metric
              label="Remaining"
              value={`$${(project.budget.totalCreditsUsd - project.budget.usedCreditsUsd).toFixed(2)}`}
              highlight
            />
          </div>
        </Card>
      )}

      {/* Event History */}
      <Card>
        <SectionTitle>Recent Events</SectionTitle>
        {runLogActivity.groups.length === 0 ? (
          <p className="text-[11px] text-gray-400 dark:text-slate-500">
            No events
          </p>
        ) : (
          <div className="space-y-1.5">
            {runLogActivity.groups.map((group) => {
              const groupTitle = formatRunLogGroupTitle(group);
              const isExpanded = Boolean(expandedGroups[group.id]);
              return (
                <div key={group.id} className="min-w-0 text-[11px]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {group.count > 1 ? (
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        className="inline-flex h-5 w-5 items-center justify-center rounded border border-gray-200 text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-100"
                        aria-label={isExpanded ? "Collapse event group" : "Expand event group"}
                        title={groupTitle}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="h-5 w-5" />
                    )}
                    <span
                      className={`mono inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClasses(group.event)}`}
                    >
                      {group.event}
                    </span>
                    {group.count > 1 && (
                      <span
                        className="mono inline-flex rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 dark:border-slate-700 dark:text-slate-400"
                        title={groupTitle}
                      >
                        x{group.count}
                      </span>
                    )}
                    <span className="mono text-gray-400 dark:text-slate-500">
                      {new Date(group.latestAt).toLocaleString()}
                    </span>
                    {group.error && (
                      <span className="truncate text-rose-600">
                        {group.error}
                      </span>
                    )}
                  </div>
                  {isExpanded && group.entries.length > 1 && (
                    <div className="ml-7 mt-1 max-h-48 space-y-1 overflow-y-auto border-l border-gray-200 pl-3 dark:border-slate-800">
                      {group.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex min-w-0 items-center gap-2 text-[10px]"
                        >
                          <span className="mono text-gray-400 dark:text-slate-500">
                            {new Date(entry.createdAt).toLocaleString()}
                          </span>
                          {entry.error && (
                            <span className="truncate text-rose-600">
                              {entry.error}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {(isLoadingActivity || runLogActivity.hasMore) && (
              <p className="mono pl-7 text-[10px] text-gray-400 dark:text-slate-500">
                {isLoadingActivity
                  ? "Loading event window..."
                  : `Showing latest ${runLogActivity.visibleEventCount} events${runLogActivity.hasMore ? "+" : ""}`}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
      {children}
    </h3>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <div
        className={`mono text-sm font-bold ${highlight ? "text-violet-600" : "text-gray-900 dark:text-slate-100"}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">
        {label}
      </div>
    </div>
  );
}
