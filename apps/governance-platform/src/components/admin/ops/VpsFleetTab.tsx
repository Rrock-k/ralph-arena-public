"use client";

import { useCallback, useState, useTransition } from "react";
import {
  destroyVpsServer,
  rebootVpsServer,
} from "@/app/actions/runtime-maintenance";
import type { VpsFleetEntry } from "@/lib/action-types";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface VpsFleetTabProps {
  entries: VpsFleetEntry[];
}

function statusBadge(status?: string) {
  if (!status) return { dot: "bg-gray-400", label: "unknown" };
  const map: Record<string, { dot: string; label: string }> = {
    running: { dot: "bg-emerald-400", label: "running" },
    initializing: { dot: "bg-blue-400 animate-pulse", label: "initializing" },
    starting: { dot: "bg-blue-400 animate-pulse", label: "starting" },
    stopping: { dot: "bg-amber-400 animate-pulse", label: "stopping" },
    off: { dot: "bg-gray-400", label: "off" },
    deleting: { dot: "bg-rose-400 animate-pulse", label: "deleting" },
    rebuilding: { dot: "bg-amber-400 animate-pulse", label: "rebuilding" },
  };
  return map[status] ?? { dot: "bg-gray-400", label: status };
}

function dbStatusBadge(status?: string) {
  const map: Record<string, { dot: string; label: string }> = {
    PROVISIONING: { dot: "bg-blue-400 animate-pulse", label: "Provisioning" },
    READY: { dot: "bg-emerald-400", label: "Ready" },
    ERROR: { dot: "bg-rose-400", label: "Error" },
    DESTROYING: { dot: "bg-amber-400 animate-pulse", label: "Destroying" },
  };
  return status ? (map[status] ?? { dot: "bg-gray-400", label: status }) : null;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.floor(diff / 60_000)}m ago`;
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type PendingAction = {
  label: string;
  description: string;
  variant: "danger" | "warn";
  serverId: string;
};

export function VpsFleetTab({ entries }: VpsFleetTabProps) {
  const [actionPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<PendingAction | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setTimeout(() => setCopiedValue(null), 1500);
    } catch { /* ignore */ }
  }, []);

  const executeAction = useCallback(() => {
    if (!confirming) return;
    const { label, serverId } = confirming;
    setConfirming(null);
    startTransition(async () => {
      const action = label === "Destroy" ? destroyVpsServer : rebootVpsServer;
      const result = await action(serverId);
      if (result.success) {
        toast.success(result.details || `${label} completed`);
      } else {
        toast.error(result.error || `${label} failed`);
      }
    });
  }, [confirming]);

  const orphanCount = entries.filter((e) => e.orphan).length;
  const totalCount = entries.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            VPS Fleet
          </h2>
          <span className="text-[11px] text-gray-400 dark:text-slate-500">
            {totalCount} server{totalCount !== 1 ? "s" : ""}
          </span>
          {orphanCount > 0 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {orphanCount} orphan{orphanCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {actionPending && (
          <span className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-slate-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-gray-600 dark:border-slate-600 dark:border-t-slate-300" />
            Processing...
          </span>
        )}
      </div>

      {totalCount === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400 dark:text-slate-500">
          No VPS servers found on Hetzner
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:border-slate-700 dark:text-slate-500">
                <th className="pb-2 pr-4">Server</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">IP</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4">Project</th>
                <th className="pb-2 pr-4">DB Status</th>
                <th className="pb-2 pr-4">Created</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const hs = statusBadge(entry.hetznerStatus);
                const ds = entry.dbRecord ? dbStatusBadge(entry.dbRecord.status) : null;
                return (
                  <tr
                    key={entry.hetznerServerId}
                    className={`border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-900 ${
                      entry.orphan ? "bg-amber-50/50 dark:bg-amber-500/5" : ""
                    }`}
                  >
                    {/* Server name */}
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="mono font-medium text-gray-700 dark:text-slate-200">
                          {entry.name}
                        </span>
                        {entry.orphan && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                            orphan
                          </span>
                        )}
                      </div>
                      <span className="mono text-[10px] text-gray-400 dark:text-slate-500">
                        #{entry.hetznerServerId}
                      </span>
                    </td>

                    {/* Hetzner status */}
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-flex h-1.5 w-1.5 rounded-full ${hs.dot}`} />
                        <span className="text-gray-600 dark:text-slate-300">{hs.label}</span>
                      </span>
                    </td>

                    {/* IP */}
                    <td className="py-2.5 pr-4">
                      {entry.ip ? (
                        <button
                          onClick={() => copy(entry.ip!)}
                          className="mono text-gray-600 transition-colors hover:text-emerald-600 dark:text-slate-300 dark:hover:text-emerald-400"
                          title="Click to copy"
                        >
                          {copiedValue === entry.ip ? "Copied!" : entry.ip}
                        </button>
                      ) : (
                        <span className="text-gray-300 dark:text-slate-600">—</span>
                      )}
                    </td>

                    {/* Type */}
                    <td className="mono py-2.5 pr-4 text-gray-600 dark:text-slate-300">
                      {entry.serverType ?? "—"}
                    </td>

                    {/* Location */}
                    <td className="mono py-2.5 pr-4 text-gray-600 dark:text-slate-300">
                      {entry.location ?? "—"}
                    </td>

                    {/* Project */}
                    <td className="py-2.5 pr-4">
                      {entry.dbRecord?.projectId ? (
                        <div>
                          <span className="text-gray-700 dark:text-slate-200">
                            {entry.dbRecord.projectName || entry.dbRecord.projectId.slice(-8)}
                          </span>
                          {entry.dbRecord.projectStatus && (
                            <span className="ml-1.5 mono text-[10px] text-gray-400 dark:text-slate-500">
                              {entry.dbRecord.projectStatus}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 dark:text-slate-600">—</span>
                      )}
                    </td>

                    {/* DB Status */}
                    <td className="py-2.5 pr-4">
                      {ds ? (
                        <span className="flex items-center gap-1.5">
                          <span className={`inline-flex h-1.5 w-1.5 rounded-full ${ds.dot}`} />
                          <span className="text-gray-600 dark:text-slate-300">{ds.label}</span>
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-slate-600">—</span>
                      )}
                    </td>

                    {/* Created */}
                    <td className="mono py-2.5 pr-4 text-gray-500 dark:text-slate-400">
                      {timeAgo(entry.created)}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        {entry.ip && (
                          <button
                            onClick={() => copy(`ssh root@${entry.ip}`)}
                            className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
                            title={`Copy: ssh root@${entry.ip}`}
                          >
                            {copiedValue === `ssh root@${entry.ip}` ? "Copied" : "SSH"}
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setConfirming({
                              label: "Reboot",
                              description: `Reboot server ${entry.name}? Running containers will restart.`,
                              variant: "warn",
                              serverId: entry.hetznerServerId,
                            })
                          }
                          disabled={actionPending || entry.hetznerStatus !== "running"}
                          className="rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:border-amber-400 hover:bg-amber-50 disabled:opacity-40 dark:border-amber-500/40 dark:text-amber-400 dark:hover:border-amber-400 dark:hover:bg-amber-500/10"
                        >
                          Reboot
                        </button>
                        <button
                          onClick={() =>
                            setConfirming({
                              label: "Destroy",
                              description: `Permanently destroy server ${entry.name} (${entry.ip ?? "no IP"})? This cannot be undone.${
                                entry.dbRecord?.projectId
                                  ? ` Linked project will lose its VPS.`
                                  : ""
                              }`,
                              variant: "danger",
                              serverId: entry.hetznerServerId,
                            })
                          }
                          disabled={actionPending}
                          className="rounded border border-rose-300 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 transition-colors hover:border-rose-400 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-500/40 dark:text-rose-400 dark:hover:border-rose-400 dark:hover:bg-rose-500/10"
                        >
                          Destroy
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm dialog */}
      <AlertDialog open={!!confirming} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.label} VPS Server</AlertDialogTitle>
            <AlertDialogDescription>{confirming?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
