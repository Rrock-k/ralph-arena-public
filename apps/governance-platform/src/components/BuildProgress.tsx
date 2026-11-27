interface ProgressData {
  state?: string;
  iteration?: number;
  featuresCompleted?: number;
  featuresTotal?: number;
  currentFeature?: { id: string; description: string };
  recentFeatures?: Array<{ id: string; description: string }>;
  steps?: Array<{ id: string; label: string; status: string }>;
}

export function BuildProgress({ progressJson }: { progressJson: string | null }) {
  let progress: ProgressData | null = null;
  if (progressJson) {
    try { progress = JSON.parse(progressJson); } catch { /* ignore */ }
  }

  if (!progress) {
    return (
      <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          Agent starting up...
        </div>
      </div>
    );
  }

  const steps = progress.steps ?? [];
  const resolvedFromSteps = steps.filter((step) => step.status === "completed" || step.status === "done" || step.status === "skipped").length;
  const skippedCount = steps.filter((step) => step.status === "skipped").length;
  const resolvedCount = steps.length > 0 ? resolvedFromSteps : progress.featuresCompleted ?? 0;
  const totalCount = steps.length > 0 ? steps.length : progress.featuresTotal ?? 0;
  const pct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
      {/* State + iteration */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="mono text-xs font-medium text-gray-600 dark:text-slate-300">
            {progress.state ?? "working"}
          </span>
        </div>
        {progress.iteration != null && (
          <span className="mono text-[11px] text-gray-500 dark:text-slate-400">
            iter {progress.iteration}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-gray-600 dark:text-slate-300">
              Tasks {resolvedCount}/{totalCount}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}
            </span>
            <span className="mono text-[11px] font-semibold text-emerald-600">{pct}%</span>
          </div>
          <div className="h-1 rounded-full bg-gray-100 dark:bg-slate-800">
            <div
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full h-1 progress-shimmer transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Current task */}
      {progress.currentFeature && (
        <div className="text-xs text-gray-600 dark:text-slate-300">
          <span className="text-gray-500 dark:text-slate-400">Now: </span>
          {progress.currentFeature.description}
        </div>
      )}

      {/* Recent completions */}
      {progress.recentFeatures && progress.recentFeatures.length > 0 && (
        <div className="space-y-0.5">
          {progress.recentFeatures.map((f) => (
            <div key={f.id} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-slate-400">
              <span className="text-emerald-500">&#10003;</span>
              <span className="truncate">{f.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
