"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  startContainer,
  stopContainer,
  restartContainer,
  removeContainer,
} from "@/app/actions/container-ops";
import { setPowerIntent } from "@/app/actions/power-intent";
import type { ContainerInfo } from "@/lib/action-types";
import {
  getPowerOffCopy,
  getPowerOffWarningCopy,
} from "@/lib/power-off-warning";
import { hasLiveAgentLoop } from "@/lib/agent-loop-activity";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface ContainerPanelProps {
  projectId: string;
  containerName: string | null | undefined;
  projectName?: string;
  projectStatus?: string;
  /** RA-237: component-level runtime state */
  powerIntent?: string;
  agentIntent?: string;
  runtimeState?: string;
  agentState?: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  if (diff < 0) return "—";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  running: { dot: "bg-emerald-400", label: "Running" },
  stopped: { dot: "bg-gray-400", label: "Stopped" },
  not_found: { dot: "bg-slate-400", label: "Not Found" },
  error: { dot: "bg-rose-400", label: "Error" },
};

async function fetchContainerInfo(projectId: string): Promise<ContainerInfo> {
  const response = await fetch(`/api/admin/projects/${encodeURIComponent(projectId)}/container`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = body && typeof body.error === "string"
      ? body.error
      : `Container inspect failed (${response.status})`;
    return { status: "error", error };
  }
  return response.json();
}

type PendingAction = {
  label: string;
  action: (id: string) => Promise<{ success: boolean; error?: string }>;
};

export function ContainerPanel({
  projectId,
  containerName,
  projectName,
  projectStatus,
  powerIntent,
  agentIntent,
  runtimeState,
  agentState,
}: ContainerPanelProps) {
  // RA-237: sleeping = powerIntent OFF AND runtimeState not RUNNING
  // OFF + RUNNING = "stopping" (transitional), not sleeping yet
  const isSleeping = powerIntent === "OFF" && runtimeState !== "RUNNING";
  const isDeployed = projectStatus === "DEPLOYED" || projectStatus === "SUCCEEDED" || projectStatus === "SLEEPING";
  const appTurnOffCopy = hasLiveAgentLoop({ runtimeState, agentIntent, agentState })
    ? getPowerOffWarningCopy(projectName)
    : getPowerOffCopy(projectName);
  const [info, setInfo] = useState<ContainerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PendingAction | null>(null);

  const fetchInfo = useCallback(async () => {
    if (!containerName) {
      setInfo({ status: "not_found" });
      return;
    }
    setLoading(true);
    try {
      const result = await fetchContainerInfo(projectId);
      setInfo(result);
    } catch {
      setInfo({ status: "error", error: "Failed to fetch" });
    } finally {
      setLoading(false);
    }
  }, [projectId, containerName]);

  useEffect(() => {
    fetchInfo();
    const interval = setInterval(fetchInfo, 15_000);
    return () => clearInterval(interval);
  }, [fetchInfo]);

  const requestAction = useCallback((pending: PendingAction) => {
    setConfirming(pending);
    setActionError(null);
  }, []);

  const executeAction = useCallback(() => {
    if (!confirming) return;
    const { action, label } = confirming;
    setConfirming(null);
    setActionLabel(label);
    startTransition(async () => {
      const result = await action(projectId);
      setActionLabel(null);
      if (!result.success) {
        setActionError(result.error ?? "Action failed");
      } else {
        setTimeout(fetchInfo, 1000);
      }
    });
  }, [confirming, projectId, fetchInfo]);

  // RA-220: for DEPLOYED projects without a container, show Turn On button
  if (!containerName) {
    if (!isDeployed) {
      return <span className="text-[11px] text-gray-400 dark:text-slate-500">No container</span>;
    }
    return (
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Status</span>
          <span className="mono flex items-center gap-1 text-[11px] font-medium text-slate-200">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-slate-400" />
            No container
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-400">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-blue-400" />
          App Off (container removed)
        </div>
        {actionError && (
          <div className="rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-400">{actionError}</div>
        )}
        <div className="flex gap-1.5 pt-1">
          <ActionButton
            onClick={() => requestAction({ label: "Turn On", action: (id: string) => setPowerIntent(id, "ON") })}
            disabled={actionPending}
            variant="success"
          >
            Turn On
          </ActionButton>
        </div>
        {actionPending && actionLabel && (
          <div className="flex items-center gap-2 pt-1 text-[10px] text-gray-500 dark:text-slate-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-gray-600 dark:border-slate-600 dark:border-t-slate-300" />
            {{ Stop: "Stopping", Start: "Starting", Restart: "Restarting", Remove: "Removing", "Turn Off": "Turning off", "Turn On": "Turning on" }[actionLabel] ?? actionLabel}...
          </div>
        )}
        <AlertDialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Turn on project</AlertDialogTitle>
              <AlertDialogDescription>
                The container was removed. This will recreate it and start the preview.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                onClick={executeAction}
              >
                Turn On
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  const style = STATUS_STYLES[info?.status ?? "error"] ?? STATUS_STYLES.error;

  return (
    <div className="space-y-2.5">
      {/* Name */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">Name</span>
        <span className="mono truncate text-[11px] font-medium text-gray-700 dark:text-slate-200" title={containerName}>
          {containerName}
        </span>
      </div>

      {/* Status */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">Status</span>
        <span className="mono flex items-center gap-1 text-[11px] font-medium text-gray-700 dark:text-slate-200">
          <span className={`inline-flex h-1.5 w-1.5 rounded-full ${style.dot} ${loading ? "animate-pulse" : ""}`} />
          {style.label}
        </span>
      </div>

      {/* Uptime */}
      {info?.status === "running" && info.startedAt && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Uptime</span>
          <span className="mono text-[11px] font-medium text-gray-700 dark:text-slate-200">
            {formatUptime(info.startedAt)}
          </span>
        </div>
      )}

      {/* Memory */}
      {info?.status === "running" && info.memoryUsageBytes != null && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Memory</span>
          <span className="mono text-[11px] font-medium text-gray-700 dark:text-slate-200">
            {formatBytes(info.memoryUsageBytes)}
            {info.memoryLimitBytes ? ` / ${formatBytes(info.memoryLimitBytes)}` : ""}
          </span>
        </div>
      )}

      {/* Memory bar */}
      {info?.status === "running" && info.memoryUsageBytes != null && info.memoryLimitBytes != null && info.memoryLimitBytes > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
          <div
            className={`h-full rounded-full transition-all ${
              info.memoryUsageBytes / info.memoryLimitBytes > 0.8
                ? "bg-rose-500"
                : info.memoryUsageBytes / info.memoryLimitBytes > 0.5
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(100, (info.memoryUsageBytes / info.memoryLimitBytes) * 100)}%` }}
          />
        </div>
      )}

      {/* Error */}
      {info?.error && (
        <div className="rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-400">
          {info.error}
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-400">
          {actionError}
        </div>
      )}

      {/* App-off badge */}
      {isDeployed && isSleeping && (
        <div className="flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-400">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-blue-400" />
          App Off
        </div>
      )}

      {/* Action buttons */}
      {info && (info.status !== "not_found" || isDeployed) && (
        <div className="flex gap-1.5 pt-1">
          {/* RA-220: Turn On for DEPLOYED with not_found container */}
          {isDeployed && info.status === "not_found" && (
            <ActionButton
              onClick={() => requestAction({ label: "Turn On", action: (id: string) => setPowerIntent(id, "ON") })}
              disabled={actionPending}
              variant="success"
            >
              Turn On
            </ActionButton>
          )}
          {isDeployed && info.status === "running" && !isSleeping && (
            <ActionButton
              onClick={() => requestAction({ label: "Turn Off", action: (id: string) => setPowerIntent(id, "OFF") })}
              disabled={actionPending}
              variant="warn"
            >
              Turn Off
            </ActionButton>
          )}
          {isDeployed && isSleeping && (
            <ActionButton
              onClick={() => requestAction({ label: "Turn On", action: (id: string) => setPowerIntent(id, "ON") })}
              disabled={actionPending}
              variant="success"
            >
              Turn On
            </ActionButton>
          )}
          {info.status === "running" && (
            <>
              {!isDeployed && (
                <ActionButton
                  onClick={() => requestAction({ label: "Stop", action: stopContainer })}
                  disabled={actionPending}
                  variant="warn"
                >
                  Stop
                </ActionButton>
              )}
              <ActionButton
                onClick={() => requestAction({ label: "Restart", action: restartContainer })}
                disabled={actionPending}
                variant="default"
              >
                Restart
              </ActionButton>
            </>
          )}
          {info.status === "stopped" && !isSleeping && (
            <ActionButton
              onClick={() => requestAction({ label: "Start", action: startContainer })}
              disabled={actionPending}
              variant="success"
            >
              Start
            </ActionButton>
          )}
          <ActionButton
            onClick={() => requestAction({ label: "Remove", action: removeContainer })}
            disabled={actionPending}
            variant="danger"
          >
            Remove
          </ActionButton>
          <button
            onClick={fetchInfo}
            disabled={loading}
            className="ml-auto rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      )}

      {/* Action in progress */}
      {actionPending && actionLabel && (
        <div className="flex items-center gap-2 pt-1 text-[10px] text-gray-500 dark:text-slate-400">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-gray-600 dark:border-slate-600 dark:border-t-slate-300" />
          {{ Stop: "Stopping", Start: "Starting", Restart: "Restarting", Remove: "Removing", "Turn Off": "Turning off", "Turn On": "Turning on" }[actionLabel] ?? actionLabel}...
        </div>
      )}

      {/* Confirm dialog */}
      <AlertDialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirming?.label === "Turn Off" ? appTurnOffCopy.title : `${confirming?.label} container`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirming?.label === "Turn Off"
                  ? appTurnOffCopy.description
                  : `Are you sure you want to ${confirming?.label?.toLowerCase()} container "${containerName}"?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
              onClick={executeAction}
            >
              {confirming?.label === "Turn Off" ? appTurnOffCopy.confirmLabel : confirming?.label}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant: "default" | "warn" | "danger" | "success";
  children: React.ReactNode;
}) {
  const base = "rounded border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50";
  const styles = {
    default:
      "border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-800 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-400 dark:hover:text-slate-100",
    warn:
      "border-amber-300 text-amber-600 hover:border-amber-400 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-400 dark:hover:border-amber-400 dark:hover:bg-amber-500/10",
    danger:
      "border-rose-300 text-rose-600 hover:border-rose-400 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-400 dark:hover:border-rose-400 dark:hover:bg-rose-500/10",
    success:
      "border-emerald-300 text-emerald-600 hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:border-emerald-400 dark:hover:bg-emerald-500/10",
  };

  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]}`}>
      {children}
    </button>
  );
}
