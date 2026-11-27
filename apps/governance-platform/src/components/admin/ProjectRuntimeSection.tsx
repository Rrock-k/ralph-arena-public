"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  cleanupProjectRuntimeArtifacts,
  destroyProjectVpsHost,
} from "@/app/actions/runtime-maintenance";

interface ProjectRuntimeSectionProps {
  projectId: string;
  projectStatus: string;
  runnerBackend: string;
  hasLiveAgentLoop: boolean;
  vpsHost: {
    status: string;
    ip: string;
    previewDomain: string | null;
    region: string;
    serverType: string;
    lastUsedAt: Date | null;
    createdAt: Date;
  } | null;
}

export function ProjectRuntimeSection({
  projectId,
  projectStatus,
  runnerBackend,
  hasLiveAgentLoop,
  vpsHost,
}: ProjectRuntimeSectionProps) {
  const [isCleaning, startCleanup] = useTransition();
  const [isDestroying, startDestroy] = useTransition();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-none sm:p-6 lg:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100 sm:text-2xl">
            Runtime
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Backend status, runtime artifacts, and infrastructure cleanup.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              startCleanup(async () => {
                const result = await cleanupProjectRuntimeArtifacts(projectId);
                if (result.success) toast.success(result.details || "Runtime artifacts cleaned");
                else toast.error(result.error || "Cleanup failed");
              });
            }}
            disabled={isCleaning || hasLiveAgentLoop}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
            title={hasLiveAgentLoop ? "Wait for the live agent loop to park before cleanup" : "Remove stale preview containers and workspace artifacts"}
          >
            {isCleaning ? "Cleaning..." : "Cleanup Artifacts"}
          </button>
          {vpsHost && (
            <button
              type="button"
              onClick={() => {
                startDestroy(async () => {
                  const result = await destroyProjectVpsHost(projectId);
                  if (result.success) toast.success(result.details || "VPS destroyed");
                  else toast.error(result.error || "Failed to destroy VPS");
                });
              }}
              disabled={isDestroying || hasLiveAgentLoop}
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              title={hasLiveAgentLoop ? "Wait for the live agent loop to park before destroying VPS" : "Destroy provisioned VPS host"}
            >
              {isDestroying ? "Destroying..." : "Destroy VPS"}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            Local Runtime
          </div>
          <div className="mt-2 space-y-1 text-sm text-gray-700 dark:text-slate-200">
            <div>Backend: <span className="mono">{runnerBackend}</span></div>
            <div>Status: <span className="mono">{projectStatus}</span></div>
            <div>Live agent loop: <span className="mono">{hasLiveAgentLoop ? "yes" : "no"}</span></div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            VPS Host
          </div>
          {vpsHost ? (
            <div className="mt-2 space-y-1 text-sm text-gray-700 dark:text-slate-200">
              <div>Status: <span className="mono">{vpsHost.status}</span></div>
              <div>IP: <span className="mono">{vpsHost.ip}</span></div>
              <div>Domain: <span className="mono">{vpsHost.previewDomain || "—"}</span></div>
              <div>Region / Type: <span className="mono">{vpsHost.region} / {vpsHost.serverType}</span></div>
              <div>Created: <span className="mono">{new Date(vpsHost.createdAt).toLocaleString()}</span></div>
              {vpsHost.lastUsedAt && (
                <div>Last used: <span className="mono">{new Date(vpsHost.lastUsedAt).toLocaleString()}</span></div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
              No provisioned VPS host is currently attached to this project.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
