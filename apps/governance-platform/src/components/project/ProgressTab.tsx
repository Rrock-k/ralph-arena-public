"use client";

import { useState } from "react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface StepData {
  id: string;
  label: string;
  status: string;
}

interface ProgressData {
  state?: string;
  iteration?: number;
  steps?: StepData[];
}

interface ProgressTabProps {
  progressJson: string | null;
  isActive: boolean;
}

export function ProgressTab({ progressJson, isActive }: ProgressTabProps) {
  let progress: ProgressData | null = null;
  if (progressJson) {
    try { progress = JSON.parse(progressJson); } catch { /* ignore */ }
  }

  if (!progress) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm text-gray-500 dark:text-slate-400">No progress data yet.</p>
      </div>
    );
  }

  const steps = progress.steps ?? [];
  const resolvedCount = steps.filter((s) => s.status === "completed" || s.status === "done" || s.status === "skipped").length;
  const skippedCount = steps.filter((s) => s.status === "skipped").length;
  const totalCount = steps.length;
  const pct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 dark:border-slate-700 dark:bg-slate-900 max-w-2xl mx-auto">
      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {progress.state && (
          <div className="flex items-center gap-1.5">
            {isActive && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />}
            <span className="mono text-[11px] font-medium text-gray-600 dark:text-slate-300">{progress.state}</span>
          </div>
        )}
        {progress.iteration != null && (
          <span className="mono text-[11px] text-gray-500 dark:text-slate-400">iter {progress.iteration}</span>
        )}
        {totalCount > 0 && (
          <span className="mono text-[11px] font-semibold text-emerald-600">
            Resolved {resolvedCount}/{totalCount}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ""} ({pct}%)
          </span>
        )}
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="mb-3 h-1 rounded-full bg-gray-100 dark:bg-slate-800">
          <div
            className="h-1 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Steps — compact list */}
      {steps.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <div className="space-y-px">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

function StepRow({ step }: { step: StepData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
        >
          <span className="inline-flex w-3.5 h-[15px] shrink-0 items-center justify-center">
            <StepIcon status={step.status} />
          </span>
          <span className={`text-[11px] leading-snug text-gray-600 dark:text-slate-300 ${expanded ? "" : "truncate"}`}>
            {step.label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm text-xs hidden sm:block">
        {step.label}
      </TooltipContent>
    </Tooltip>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "completed" || status === "done") {
    return <span className="text-emerald-500 text-[11px] leading-none">&#10003;</span>;
  }
  if (status === "in_progress" || status === "running") {
    return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />;
  }
  if (status === "skipped") {
    return <span className="text-gray-400 dark:text-slate-500 text-[11px] leading-none">-</span>;
  }
  if (status === "failed") {
    return <span className="text-rose-400 text-[11px] leading-none">&#10007;</span>;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-slate-600" />;
}
