"use client";

import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface ProgressData {
  state?: string;
  message?: string;
  iteration?: number;
  featuresCompleted?: number;
  featuresTotal?: number;
  currentFeature?: { id: string; description: string };
  recentFeatures?: Array<{ id: string; description: string }>;
  steps?: Array<{ id: string; label: string; status: string }>;
}

interface CyclePanelProps {
  progressJson?: string | null;
  status: string;
}

const ACTIVE_STATUSES = new Set(["BUILDING"]);

export function CyclePanel({ progressJson, status }: CyclePanelProps) {
  let progress: ProgressData | null = null;
  if (progressJson) {
    try { progress = JSON.parse(progressJson); } catch { /* ignore */ }
  }

  const isActive = ACTIVE_STATUSES.has(status);

  if (!progress) {
    return <span className="text-[11px] text-gray-400 dark:text-slate-500">No cycle data</span>;
  }
  const steps = progress.steps ?? [];
  const resolvedFromSteps = steps.filter((step) => step.status === "completed" || step.status === "done" || step.status === "skipped").length;
  const skippedCount = steps.filter((step) => step.status === "skipped").length;
  const resolvedCount = steps.length > 0 ? resolvedFromSteps : progress.featuresCompleted ?? 0;
  const totalCount = steps.length > 0 ? steps.length : progress.featuresTotal ?? 0;
  const pct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-2.5">
      {/* Phase */}
      {progress?.state && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Phase</span>
          <span className="mono flex items-center gap-1.5 text-[11px] font-medium text-gray-700 dark:text-slate-200">
            {isActive && (
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            )}
            {progress.state}
          </span>
        </div>
      )}

      {/* Iteration */}
      {progress?.iteration != null && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Iteration</span>
          <span className="mono text-[11px] font-medium text-gray-700 dark:text-slate-200">
            {progress.iteration}
          </span>
        </div>
      )}

      {/* Progress bar */}
      {totalCount > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-gray-600 dark:text-slate-300">
              Resolved {resolvedCount}/{totalCount}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}
            </span>
            <span className="mono text-[11px] font-semibold text-emerald-600">{pct}%</span>
          </div>
          <div className="h-1 rounded-full bg-gray-100 dark:bg-slate-800">
            <div
              className="h-1 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Message */}
      {progress?.message && (
        <div className="text-[11px] text-gray-600 dark:text-slate-300">
          {progress.message}
        </div>
      )}

      {/* Current feature */}
      {progress?.currentFeature && (
        <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
          <span className="text-[10px] text-gray-400 dark:text-slate-500">Current</span>
          <div className="mt-0.5 text-[11px] text-gray-700 dark:text-slate-200">
            {progress.currentFeature.description}
          </div>
        </div>
      )}

      {/* Recent completions */}
      {progress?.recentFeatures && progress.recentFeatures.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <div className="space-y-0.5">
            {progress.recentFeatures.map((f) => (
              <Tooltip key={f.id}>
                <TooltipTrigger asChild>
                  <div className="flex items-start gap-1.5 text-[11px] text-gray-500 dark:text-slate-400">
                    <span className="inline-flex w-4 shrink-0 items-center justify-center text-emerald-500">✓</span>
                    <span className="truncate">{f.description}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">
                  {f.description}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      )}

      {/* Steps */}
      {progress?.steps && progress.steps.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <div className="space-y-0.5">
            {progress.steps.map((step) => (
              <Tooltip key={step.id}>
                <TooltipTrigger asChild>
                  <div className="flex items-start gap-1.5 text-[11px]">
                    <span className="inline-flex w-4 shrink-0 items-center justify-center">
                      <StepIcon status={step.status} />
                    </span>
                    <span className="truncate text-gray-600 dark:text-slate-300">{step.label}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">
                  {step.label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      )}

    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  // All icons render at text line-height (leading-[16px]) so they align with the first line of text
  const dotWrap = "inline-flex h-[16px] items-center";
  if (status === "completed" || status === "done") {
    return <span className="leading-[16px] text-emerald-500">✓</span>;
  }
  if (status === "in_progress" || status === "running") {
    return <span className={dotWrap}><span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" /></span>;
  }
  if (status === "skipped") {
    return <span className="leading-[16px] text-gray-400 dark:text-slate-500">-</span>;
  }
  if (status === "failed") {
    return <span className="leading-[16px] text-rose-400">✗</span>;
  }
  return <span className={dotWrap}><span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-slate-600" /></span>;
}
