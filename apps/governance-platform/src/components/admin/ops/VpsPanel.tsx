"use client";

import { useCallback, useState, useTransition } from "react";
import {
  destroyProjectVpsHost,
  rebootProjectVps,
} from "@/app/actions/runtime-maintenance";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface VpsInfo {
  id: string;
  status: string;
  ip?: string | null;
  region?: string | null;
  serverType?: string | null;
}

interface VpsPanelProps {
  projectId: string;
  vpsHost: VpsInfo | null | undefined;
  projectStatus: string;
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  PROVISIONING: { dot: "bg-blue-400 animate-pulse", label: "Provisioning" },
  READY: { dot: "bg-emerald-400", label: "Ready" },
  ERROR: { dot: "bg-rose-400", label: "Error" },
  DESTROYING: { dot: "bg-amber-400 animate-pulse", label: "Destroying" },
};

const ACTIVE_STATUSES = new Set(["PROVISIONING", "QUEUED", "RUNNING", "PAUSING", "STARTING"]);

type PendingAction = {
  label: string;
  description: string;
  variant: "danger" | "warn";
  action: () => Promise<{ success: boolean; error?: string }>;
};

export function VpsPanel({ projectId, vpsHost, projectStatus }: VpsPanelProps) {
  const [actionPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PendingAction | null>(null);
  const [copiedIp, setCopiedIp] = useState(false);

  const isActive = ACTIVE_STATUSES.has(projectStatus);

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
      const result = await action();
      setActionLabel(null);
      if (!result.success) {
        setActionError(result.error ?? "Action failed");
      }
    });
  }, [confirming]);

  const copyIp = useCallback(async (ip: string) => {
    try {
      await navigator.clipboard.writeText(ip);
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 1500);
    } catch { /* ignore */ }
  }, []);

  if (!vpsHost) {
    return <span className="text-[11px] text-gray-400 dark:text-slate-500">No VPS</span>;
  }

  const style = STATUS_STYLES[vpsHost.status] ?? STATUS_STYLES.ERROR;

  return (
    <div className="space-y-2.5">
      {/* Status */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">Status</span>
        <span className="mono flex items-center gap-1 text-[11px] font-medium text-gray-700 dark:text-slate-200">
          <span className={`inline-flex h-1.5 w-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </div>

      {/* IP */}
      {vpsHost.ip && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">IP</span>
          <button
            onClick={() => copyIp(vpsHost.ip!)}
            className="mono text-[11px] font-medium text-gray-700 transition-colors hover:text-emerald-600 dark:text-slate-200 dark:hover:text-emerald-400"
            title="Click to copy"
          >
            {copiedIp ? "Copied!" : vpsHost.ip}
          </button>
        </div>
      )}

      {/* Region */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">Region</span>
        <span className="mono text-[11px] font-medium text-gray-700 dark:text-slate-200">
          {vpsHost.region ?? "—"}
        </span>
      </div>

      {/* Type */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">Type</span>
        <span className="mono text-[11px] font-medium text-gray-700 dark:text-slate-200">
          {vpsHost.serverType ?? "—"}
        </span>
      </div>

      {/* SSH connect hint */}
      {vpsHost.ip && vpsHost.status === "READY" && (
        <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
          <span className="text-[10px] text-gray-400 dark:text-slate-500">SSH</span>
          <button
            onClick={() => copyIp(`ssh root@${vpsHost.ip}`)}
            className="mono mt-0.5 block w-full truncate text-left text-[10px] text-gray-600 transition-colors hover:text-emerald-600 dark:text-slate-300 dark:hover:text-emerald-400"
            title="Click to copy"
          >
            ssh root@{vpsHost.ip}
          </button>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-400">
          {actionError}
        </div>
      )}

      {/* Action buttons */}
      {vpsHost.status === "READY" && (
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={() =>
              requestAction({
                label: "Reboot",
                description: "This will reboot the VPS server. Running containers will be restarted.",
                variant: "warn",
                action: () => rebootProjectVps(projectId),
              })
            }
            disabled={actionPending}
            className="rounded border border-amber-300 px-2 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-500/40 dark:text-amber-400 dark:hover:border-amber-400 dark:hover:bg-amber-500/10"
          >
            Reboot
          </button>
          <button
            onClick={() =>
              requestAction({
                label: "Destroy",
                description: isActive
                  ? "Cannot destroy VPS while project is active."
                  : "This will permanently destroy the VPS server and all data on it. This action cannot be undone.",
                variant: "danger",
                action: () => destroyProjectVpsHost(projectId),
              })
            }
            disabled={actionPending || isActive}
            className="rounded border border-rose-300 px-2 py-0.5 text-[10px] font-medium text-rose-600 transition-colors hover:border-rose-400 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-400 dark:hover:border-rose-400 dark:hover:bg-rose-500/10"
            title={isActive ? "Cannot destroy while project is active" : undefined}
          >
            Destroy
          </button>
        </div>
      )}

      {/* Action in progress */}
      {actionPending && actionLabel && (
        <div className="flex items-center gap-2 pt-1 text-[10px] text-gray-500 dark:text-slate-400">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-gray-600 dark:border-slate-600 dark:border-t-slate-300" />
          {{ Reboot: "Rebooting", Destroy: "Destroying" }[actionLabel] ?? actionLabel}...
        </div>
      )}

      {/* Confirm dialog */}
      <AlertDialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.label} VPS</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Don't show confirm if it's an "active" error */}
            {!(confirming?.label === "Destroy" && isActive) && (
              <button
                type="button"
                className={`inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                  confirming?.variant === "danger"
                    ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
                onClick={executeAction}
              >
                {confirming?.label}
              </button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
