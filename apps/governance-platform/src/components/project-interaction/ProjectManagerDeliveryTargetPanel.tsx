"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, RadioTower, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  activateProjectUpdateDeliveryTargetFromTgSpecBinding,
  revokeProjectUpdateDeliveryTarget,
} from "@/app/actions/project-update-delivery-targets";

export type ProjectManagerDeliveryTargetView = {
  id: string;
  sourceTargetId: string;
  targetKind: string;
  status: string;
  label: string | null;
  requiredCapability: string | null;
  activatedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
};

export type TgSpecManagerBindingCandidateView = {
  sourceTargetId: string;
  targetKind: string;
  label: string | null;
  channelId: string | null;
  chatId: string | null;
  messageThreadId: string | null;
  topicTitle: string | null;
  channelTitle: string | null;
  channelType: string | null;
  projectId: string | null;
  projectSlug: string | null;
  projectTitle: string | null;
  state: string;
  boundAt: string | null;
  updatedAt: string | null;
  arenaManagerDeliveryTargetId: string | null;
};

export type ProjectManagerDeliveryTargetState = {
  activeTarget: ProjectManagerDeliveryTargetView | null;
  recentTargets: ProjectManagerDeliveryTargetView[];
  tgSpecBindings: {
    configured: boolean;
    candidates: TgSpecManagerBindingCandidateView[];
    error: string | null;
  };
};

type ProjectManagerDeliveryTargetPanelProps = {
  projectId: string;
  activeTarget: ProjectManagerDeliveryTargetView | null;
  recentTargets: ProjectManagerDeliveryTargetView[];
  tgSpecBindings: ProjectManagerDeliveryTargetState["tgSpecBindings"];
};

function statusClasses(status: string) {
  if (status === "ACTIVE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
  }
  if (status === "PAUSED") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
  }
  return "border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function bindingTitle(binding: TgSpecManagerBindingCandidateView) {
  return binding.label || binding.topicTitle || binding.channelTitle || binding.sourceTargetId;
}

function bindingMeta(binding: TgSpecManagerBindingCandidateView) {
  return [
    binding.channelTitle,
    binding.topicTitle,
    binding.chatId ? `chat ${binding.chatId}` : null,
    binding.messageThreadId ? `topic ${binding.messageThreadId}` : null,
  ].filter(Boolean).join(" · ");
}

export function ProjectManagerDeliveryTargetPanel({
  projectId,
  activeTarget,
  recentTargets,
  tgSpecBindings,
}: ProjectManagerDeliveryTargetPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const inactiveTargets = useMemo(
    () => recentTargets.filter((target) => target.status !== "ACTIVE"),
    [recentTargets],
  );
  const boundTargets = tgSpecBindings.candidates;

  const activateBoundTarget = (binding: TgSpecManagerBindingCandidateView) => {
    startTransition(async () => {
      const result = await activateProjectUpdateDeliveryTargetFromTgSpecBinding(
        projectId,
        binding.sourceTargetId,
      );
      if (!result.success) {
        toast.error(result.error || "Failed to activate Telegram destination");
        return;
      }
      toast.success("Manager Telegram destination is active");
      router.refresh();
    });
  };

  const revokeTarget = () => {
    if (!activeTarget) return;
    startTransition(async () => {
      const result = await revokeProjectUpdateDeliveryTarget(projectId, activeTarget.id);
      if (!result.success) {
        toast.error(result.error || "Failed to revoke Telegram destination");
        return;
      }
      toast.success("Manager Telegram destination revoked");
      router.refresh();
    });
  };

  const copyTargetId = async () => {
    if (!activeTarget) return;
    await navigator.clipboard.writeText(activeTarget.id);
    toast.success("Arena target id copied");
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-slate-100">
                <RadioTower className="h-4 w-4" />
                Manager Telegram destination
              </span>
              <span
                className={`mono inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClasses(activeTarget?.status ?? "REVOKED")}`}
              >
                {activeTarget?.status ?? "NOT SET"}
              </span>
            </div>
            {activeTarget ? (
              <div className="space-y-1 text-xs text-gray-500 dark:text-slate-400">
                <p>
                  {activeTarget.label || "Telegram project room"} · active since {formatDate(activeTarget.activatedAt)}
                </p>
                <p className="mono break-all">
                  Telegram ref: {activeTarget.sourceTargetId}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                Choose which bound Telegram chat or topic is allowed to receive manager-only updates.
              </p>
            )}
          </div>
          {activeTarget && (
            <button
              type="button"
              onClick={copyTargetId}
              className="inline-flex w-fit items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-500 hover:text-gray-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
            >
              <Copy className="h-4 w-4" />
              Copy Arena target id
            </button>
          )}
        </div>
      </div>

      {boundTargets.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-normal text-gray-400 dark:text-slate-500">
            Project Telegram rooms
          </div>
          <div className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
            {boundTargets.map((binding) => {
              const isActive =
                activeTarget?.sourceTargetId === binding.sourceTargetId ||
                (Boolean(binding.arenaManagerDeliveryTargetId) && binding.arenaManagerDeliveryTargetId === activeTarget?.id);
              return (
                <div
                  key={binding.sourceTargetId}
                  className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                        {bindingTitle(binding)}
                      </span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Receiving manager updates
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                      {bindingMeta(binding) || binding.sourceTargetId}
                    </p>
                    <p className="mono mt-1 break-all text-[11px] text-gray-400 dark:text-slate-500">
                      {binding.sourceTargetId}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => activateBoundTarget(binding)}
                    disabled={isPending || isActive}
                    className="inline-flex w-fit items-center justify-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:cursor-default disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                  >
                    {isActive ? "Selected" : "Use this room"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tgSpecBindings.error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <span>Could not load Telegram room candidates: {tgSpecBindings.error}</span>
        </div>
      )}

      {!tgSpecBindings.error && boundTargets.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <span>
            No verified Telegram room candidate is available. Link the project from tg-spec first,
            then choose the bound room here.
          </span>
        </div>
      )}

      {activeTarget && (
        <button
          type="button"
          onClick={revokeTarget}
          disabled={isPending}
          className="inline-flex w-fit items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 transition-colors hover:border-rose-400 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
        >
          <Trash2 className="h-4 w-4" />
          Revoke
        </button>
      )}

      {inactiveTargets.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-normal text-gray-400 dark:text-slate-500">
            Recent destinations
          </div>
          <div className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-slate-700 dark:border-slate-700">
            {inactiveTargets.slice(0, 3).map((target) => (
              <div
                key={target.id}
                className="flex w-full flex-col gap-1 px-3 py-2 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`mono rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClasses(target.status)}`}>
                    {target.status}
                  </span>
                  <span className="text-xs font-medium text-gray-700 dark:text-slate-300">
                    {target.label || "Unlabeled"}
                  </span>
                </div>
                <span className="mono break-all text-xs text-gray-500 dark:text-slate-400">
                  {target.sourceTargetId}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
