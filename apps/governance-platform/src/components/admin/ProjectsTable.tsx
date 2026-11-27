"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { BuildProgress } from "@/components/BuildProgress";
import { AgentOnButton } from "./AgentOnButton";
import { RelaunchButton } from "./RelaunchButton";
import { UnarchiveProjectButton } from "./UnarchiveProjectButton";
import { formatAgentLabel } from "@/lib/agent-labels-shared";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { BackendBadgeCompact } from "./BackendBadge";
import { formatRetryHint, formatRetryHintTooltip } from "@/lib/retry-status";
import { getRuntimeStartBlockReason } from "./ProjectActions";
import { getStatusClasses } from "@/lib/status-classes";
import { getProjectName } from "@/lib/project-identity";
import { getBatchPowerOffCopy } from "@/lib/power-off-warning";
import { hasLiveAgentLoop } from "@/lib/agent-loop-activity";
import { StatusBadge } from "./StatusBadge";
import { archiveProject } from "@/app/actions/archive";
import { setPowerIntent } from "@/app/actions/power-intent";
import { deleteProject } from "@/app/actions/project-manage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ProjectFacingAgentLoop } from "@/lib/project-facing-agent-loops";
import {
  getAppComponent,
  getOpsDisplayStatus,
  isOpsActiveStatus,
} from "@/lib/operator-display";

const ABSOLUTE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatRelativeTime(date: string | Date, now: number) {
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function formatAbsoluteTime(date: string | Date) {
  return ABSOLUTE_DATE_FORMATTER.format(new Date(date));
}

interface ProjectsTableProps {
  projects: any[];
  tools: any[];
  agentLoops: ProjectFacingAgentLoop[];
  onProjectClick?: (projectId: string) => void;
  canManagePlatformProjects?: boolean;
  canManagePlatformRuntime?: boolean;
  userProviderCredentialsEnabled?: boolean;
  managedProviderCreditsEnabled?: boolean;
}

function hasProjectCapability(project: any, capability: string): boolean {
  return (
    Array.isArray(project.accessCapabilities) &&
    project.accessCapabilities.includes(capability)
  );
}

export function ProjectsTable({
  projects,
  tools,
  agentLoops,
  onProjectClick,
  canManagePlatformProjects = false,
  canManagePlatformRuntime = false,
  userProviderCredentialsEnabled = false,
  managedProviderCreditsEnabled = false,
}: ProjectsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [relativeNow, setRelativeNow] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchPending, startBatchTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const update = () => setRelativeNow(Date.now());
    update();
    const intervalId = window.setInterval(update, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === projects.length) setSelected(new Set());
    else setSelected(new Set(projects.map((p: any) => p.id)));
  };

  const [confirmAction, setConfirmAction] = useState<{
    type: "powerOff" | "archive" | "delete";
    label: string;
    variant: "default" | "danger";
  } | null>(null);
  const [batchRemoveDocker, setBatchRemoveDocker] = useState(true);
  const [batchRemoveWorkspace, setBatchRemoveWorkspace] = useState(true);

  const selectedProjects = projects.filter((p: any) => selected.has(p.id));
  const selectedActiveLoopCount = selectedProjects.filter((project: any) =>
    hasLiveAgentLoop(project),
  ).length;
  const batchPowerOffCopy = getBatchPowerOffCopy(
    selectedActiveLoopCount,
    selected.size,
  );

  const executeBatchAction = () => {
    if (!confirmAction) return;
    const { type, label } = confirmAction;
    startBatchTransition(async () => {
      const ids = Array.from(selected);
      let ok = 0;
      let fail = 0;
      for (const id of ids) {
        try {
          const result =
            type === "powerOff"
              ? await setPowerIntent(id, "OFF")
              : type === "archive"
                ? await archiveProject(id)
                : await deleteProject(id, {
                    removeDocker: batchRemoveDocker,
                    removeWorkspace: batchRemoveWorkspace,
                  });
          if (!result.success) {
            throw new Error(result.error ?? "Batch action failed");
          }
          ok++;
        } catch {
          fail++;
        }
      }
      setSelected(new Set());
      setConfirmAction(null);
      router.refresh();
      if (fail) toast.error(`${label}: ${ok} succeeded, ${fail} failed`);
      else toast.success(`${label}: ${ok} projects`);
    });
  };

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        No projects yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Batch action toolbar */}
      {canManagePlatformProjects && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm dark:border-blue-500/30">
          <label className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
            <input
              type="checkbox"
              checked={selected.size === projects.length}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5 rounded accent-blue-600"
            />
            {selected.size} selected
          </label>
          <button
            onClick={() =>
              setConfirmAction({
                type: "powerOff",
                label: "App Off",
                variant: "default",
              })
            }
            disabled={batchPending}
            className="rounded border border-blue-400/40 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-500/20"
          >
            App Off Selected
          </button>
          <button
            onClick={() =>
              setConfirmAction({
                type: "archive",
                label: "Archive",
                variant: "danger",
              })
            }
            disabled={batchPending}
            className="rounded border border-rose-400/40 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/20"
          >
            Archive Selected
          </button>
          <button
            onClick={() =>
              setConfirmAction({
                type: "delete",
                label: "Delete",
                variant: "danger",
              })
            }
            disabled={batchPending}
            className="rounded border border-rose-400/40 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/20"
          >
            Delete Selected
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Clear
          </button>
        </div>
      )}
      {projects.map((project) => {
        const isExpanded = expandedId === project.id;
        const app = getAppComponent(project);
        const displayStatus = getOpsDisplayStatus(project);
        const hasActiveRun = isOpsActiveStatus(displayStatus);
        const isPaused = displayStatus === "PAUSED";
        const retryHint = formatRetryHint(app?.retryAt ?? null);
        const retryHintTooltip = formatRetryHintTooltip(app?.retryAt ?? null);
        const canManageRuntime = hasProjectCapability(
          project,
          "project.runtime.manage",
        );
        const canManageProject =
          canManageRuntime ||
          hasProjectCapability(project, "project.settings.manage");
        const hasBudgetLimit = !!project.budget?.isEnabled;
        const budgetTotal = project.budget?.totalCreditsUsd ?? 0;
        const budgetUsed = project.budget?.usedCreditsUsd ?? 0;
        const budgetRatio =
          hasBudgetLimit && budgetTotal > 0 ? budgetUsed / budgetTotal : 0;
        const projectTitle = getProjectName(project);
        const runtimeStartBlockReason = getRuntimeStartBlockReason({
          projectId: project.id,
          projectName: projectTitle,
          project,
          canManagePlatformProjects,
          canManagePlatformRuntime,
          userProviderCredentialsEnabled,
          managedProviderCreditsEnabled,
        });

        return (
          <div
            key={project.id}
            className="rounded-xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Project row */}
            <div
              className="flex cursor-pointer items-center gap-3 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/80"
              onClick={() => setExpandedId(isExpanded ? null : project.id)}
            >
              {/* Select checkbox */}
              <input
                type="checkbox"
                checked={selected.has(project.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleSelect(project.id);
                }}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 shrink-0 rounded accent-blue-600"
                disabled={!canManagePlatformProjects}
              />

              {/* Expand icon */}
              <svg
                className={`h-4 w-4 shrink-0 text-gray-500 transition-transform dark:text-slate-400 ${isExpanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>

              {/* Pin indicator */}
              {project.isPinned && (
                <svg
                  className="h-3.5 w-3.5 shrink-0 text-amber-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                </svg>
              )}

              {/* Proposal title */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {onProjectClick ? (
                    <button
                      className="truncate text-sm font-medium text-gray-900 transition-colors hover:text-emerald-600 dark:text-slate-100 dark:hover:text-emerald-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        onProjectClick(project.id);
                      }}
                    >
                      {projectTitle}
                    </button>
                  ) : (
                    <Link
                      href={`/admin?project=${project.id}&tab=overview`}
                      className="truncate text-sm font-medium text-gray-900 transition-colors hover:text-emerald-600 dark:text-slate-100 dark:hover:text-emerald-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {projectTitle}
                    </Link>
                  )}
                  {project.archivedAt && canManageRuntime && (
                    <UnarchiveProjectButton projectId={project.id} />
                  )}
                  {!project.archivedAt &&
                    !hasActiveRun &&
                    isPaused &&
                    canManageRuntime &&
                    !runtimeStartBlockReason && (
                      <AgentOnButton
                        projectId={project.id}
                        loopRuntime={project.loopRuntime}
                        loopSupportStatus={project.loopSupportStatus}
                        agentStartAllowed={project.agentStartAllowed}
                      />
                    )}
                </div>
              </div>

              {/* Status badge */}
              <StatusBadge
                status={displayStatus}
                className="mono hidden shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:inline-flex"
              />

              {/* Backend + Agent */}
              {(canManagePlatformProjects || canManagePlatformRuntime) && (
                <BackendBadgeCompact backend={project.runnerBackend} />
              )}
              <span className="mono hidden shrink-0 text-xs text-gray-500 md:inline dark:text-slate-400">
                {formatAgentLabel(
                  project.agent,
                  project.agentImpl,
                  project.model,
                )}
              </span>

              {/* Budget */}
              {hasBudgetLimit && (
                <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  <div className="w-20">
                    <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-slate-700">
                      <div
                        className={`h-1.5 rounded-full transition-all ${
                          budgetRatio > 0.8
                            ? "bg-rose-500"
                            : budgetRatio > 0.5
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                        }`}
                        style={{
                          width: `${Math.min(100, budgetRatio * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="mono text-[11px] text-gray-500 dark:text-slate-400">
                    ${budgetUsed.toFixed(2)}/${budgetTotal.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Last activity */}
              <span
                className="mono hidden shrink-0 text-xs text-gray-500 lg:inline dark:text-slate-400"
                suppressHydrationWarning
              >
                {relativeNow
                  ? formatRelativeTime(project.updatedAt, relativeNow)
                  : formatAbsoluteTime(project.updatedAt)}
              </span>

              {/* Actions */}
              <div
                className="flex shrink-0 items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                {!hasActiveRun && !isPaused && canManageRuntime && (
                  <RelaunchButton
                    projectId={project.id}
                    currentAgent={project.agent}
                    currentAgentImpl={project.agentImpl}
                    currentModel={project.model}
                    currentRunnerBackend={project.runnerBackend}
                    currentProviderBillingMode={(project as any).providerBillingMode}
                    tools={tools}
                    agentLoops={agentLoops}
                    allowPlatformCredentials={canManagePlatformProjects}
                    allowManagedVps={canManagePlatformProjects}
                    userProviderCredentialsEnabled={userProviderCredentialsEnabled}
                    managedProviderCreditsEnabled={managedProviderCreditsEnabled}
                  />
                )}
                {onProjectClick ? (
                  <button
                    onClick={() => onProjectClick(project.id)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  >
                    Open
                  </button>
                ) : (
                  <Link
                    href={`/admin?project=${project.id}&tab=overview`}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  >
                    Open
                  </Link>
                )}
                {canManageProject && (
                  <ProjectContextMenu
                    projectId={project.id}
                    projectName={projectTitle}
                    project={project}
                    canManagePlatformProjects={canManagePlatformProjects}
                    canManagePlatformRuntime={canManagePlatformRuntime}
                    userProviderCredentialsEnabled={userProviderCredentialsEnabled}
                    managedProviderCreditsEnabled={managedProviderCreditsEnabled}
                  />
                )}
              </div>
            </div>

            {/* Expanded: project details */}
            {isExpanded && (
              <div className="border-t border-gray-200 px-4 pb-4 pt-3 dark:border-slate-800">
                {/* Current status details */}
                {hasActiveRun && (
                  <BuildProgress progressJson={project.progressJson} />
                )}
                {isPaused && retryHint && (
                  <p
                    className="mt-1 text-xs text-amber-700 dark:text-amber-300"
                    title={retryHintTooltip ?? undefined}
                  >
                    {retryHint}
                  </p>
                )}

                {/* RunLog history */}
                {project.runLogs && project.runLogs.length > 0 && (
                  <div className="mt-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      Event History
                    </h4>
                    <div className="space-y-1">
                      {project.runLogs.map((log: any) => (
                        <div
                          key={log.id}
                          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/80"
                        >
                          <span
                            className={`mono inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStatusClasses(log.event)}`}
                          >
                            {log.event}
                          </span>
                          <span
                            className="mono text-[11px] text-gray-500 dark:text-slate-400"
                            suppressHydrationWarning
                          >
                            {new Date(log.createdAt).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Batch action confirmation dialog */}
      <Dialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <DialogContent className="max-w-md dark:border-slate-700 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="dark:text-slate-100">
              {confirmAction?.type === "powerOff"
                ? batchPowerOffCopy.title
                : `${confirmAction?.label} ${selected.size} project${selected.size !== 1 ? "s" : ""}?`}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              {confirmAction?.type === "powerOff"
                ? batchPowerOffCopy.description
                : `This will ${confirmAction?.label.toLowerCase()} the following projects:`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 overflow-y-auto rounded border border-slate-200 dark:border-slate-700">
            {selectedProjects.map((p: any) => {
              const pApp = getAppComponent(p);
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm dark:border-slate-800"
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${pApp?.containerName ? "bg-emerald-400" : "bg-slate-400"}`}
                  />
                  <span className="truncate dark:text-slate-200">
                    {getProjectName(p)}
                  </span>
                  {pApp?.containerName && (
                    <span className="ml-auto truncate text-[10px] text-slate-400 mono">
                      {pApp.containerName}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {confirmAction?.type === "delete" && (
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-slate-300 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchRemoveDocker}
                  onChange={(e) => setBatchRemoveDocker(e.target.checked)}
                  disabled={batchPending}
                  className="h-4 w-4 rounded border-gray-300 accent-rose-600"
                />
                Remove Docker containers
              </label>
              <label className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-slate-300 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchRemoveWorkspace}
                  onChange={(e) => setBatchRemoveWorkspace(e.target.checked)}
                  disabled={batchPending}
                  className="h-4 w-4 rounded border-gray-300 accent-rose-600"
                />
                Remove workspaces
              </label>
            </div>
          )}
          <DialogFooter>
            <button
              onClick={() => setConfirmAction(null)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              onClick={executeBatchAction}
              disabled={batchPending}
              className={`rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50 ${
                confirmAction?.variant === "danger"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {batchPending
                ? "Working..."
                : confirmAction?.type === "powerOff"
                  ? batchPowerOffCopy.confirmLabel
                  : `${confirmAction?.label} ${selected.size} projects`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
