"use client";

import type { ProviderQuotaResponse } from "@/lib/provider-quotas";
import { providerQuotaDisplayName, quotaSourceDisplayName } from "@/lib/provider-quota-display";

interface QuotaPanelProps {
  quotaSnapshot: ProviderQuotaResponse | null;
  loading: boolean;
  error: string | null;
}

function formatResetAt(value: string | null): string {
  if (!value) return "No reset time";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatUsageLabel(window: {
  usedPercent: number | null;
  valueLabel: string | null;
}): string {
  if (window.valueLabel) return window.valueLabel;
  if (window.usedPercent == null) return "n/a";
  return `${window.usedPercent}% used`;
}

export function QuotaPanel({ quotaSnapshot, loading, error }: QuotaPanelProps) {
  const providerOrder = { anthropic: 0, openai: 1 } as const;
  const results = [...(quotaSnapshot?.results ?? [])].sort(
    (a, b) => providerOrder[a.provider] - providerOrder[b.provider],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
        Provider Quotas
      </h3>
      <p className="mb-3 text-[11px] text-gray-500 dark:text-slate-400">
        Admin-wide subscription limits, separate from project budgets.
      </p>

      {quotaSnapshot?.generatedAt && (
        <p className="mb-3 text-[10px] text-gray-400 dark:text-slate-500">
          Updated {new Date(quotaSnapshot.generatedAt).toLocaleTimeString()}
        </p>
      )}

      {loading && !quotaSnapshot && (
        <p className="text-[11px] text-gray-400 dark:text-slate-500">Loading quota windows...</p>
      )}

      {error && (
        <p className="text-[11px] text-rose-600">{error}</p>
      )}

      {!loading && !error && results.length === 0 && (
        <p className="text-[11px] text-gray-400 dark:text-slate-500">No provider quota data available.</p>
      )}

      {results.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {results.map((result) => (
            <div
              key={result.provider}
              className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    {providerQuotaDisplayName(result.provider)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">
                    Source: {quotaSourceDisplayName(result.source)}
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    result.ok
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                  }`}
                >
                  {result.ok ? "ok" : "error"}
                </span>
              </div>

              {!result.ok && (
                <p className="mt-2 text-[11px] text-rose-600">{result.error ?? "Quota polling failed."}</p>
              )}

              {result.ok && result.windows.length === 0 && (
                <p className="mt-2 text-[11px] text-gray-400 dark:text-slate-500">No windows returned.</p>
              )}

              {result.ok && result.windows.length > 0 && (
                <div className="mt-3 space-y-2">
                  {result.windows.map((window) => {
                    const barWidth = Math.max(0, Math.min(100, window.usedPercent ?? 0));
                    const barClass =
                      (window.usedPercent ?? 0) >= 95
                        ? "bg-rose-400"
                        : (window.usedPercent ?? 0) >= 75
                          ? "bg-amber-400"
                          : "bg-emerald-400";

                    return (
                      <div key={`${result.provider}:${window.label}`} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-medium text-gray-700 dark:text-slate-200">{window.label}</span>
                          <span className="mono text-gray-500 dark:text-slate-400">
                            {formatUsageLabel(window)}
                          </span>
                        </div>
                        {window.usedPercent != null && (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
                            <div className={`h-full ${barClass}`} style={{ width: `${barWidth}%` }} />
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400 dark:text-slate-500">
                          <span>{window.detail ?? "\u00A0"}</span>
                          <span>{formatResetAt(window.resetsAt)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
