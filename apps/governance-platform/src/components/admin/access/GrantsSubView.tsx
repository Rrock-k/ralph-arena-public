"use client";

import { useState } from "react";
import type { AccessGrantRecord, AccessGrantVisualState } from "@/lib/access-control/types";
import { getAccessGrantVisualState } from "@/lib/access-control/utils";
import { AccessGrantBadge } from "./AccessGrantBadge";
import { RevokeAccessGrantButton } from "./RevokeAccessGrantButton";

interface GrantsSubViewProps {
  grants: AccessGrantRecord[];
  onGrantAccess?: () => void;
}

export function GrantsSubView({ grants, onGrantAccess }: GrantsSubViewProps) {
  const [stateFilter, setStateFilter] = useState<"all" | AccessGrantVisualState>("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "platform" | "project">("all");

  const filtered = grants.filter((g) => {
    if (stateFilter !== "all" && getAccessGrantVisualState(g) !== stateFilter) return false;
    if (scopeFilter !== "all" && g.scope.type !== scopeFilter) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const stateOrder = { active: 0, expired: 1, revoked: 2 };
    const diff = stateOrder[getAccessGrantVisualState(a)] - stateOrder[getAccessGrantVisualState(b)];
    if (diff !== 0) return diff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-4">
      {/* Header with filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* State filter */}
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-slate-700/50 dark:bg-slate-800/50">
            {(["all", "active", "expired", "revoked"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStateFilter(f)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  stateFilter === f
                    ? "bg-gray-900 text-white dark:bg-slate-700 dark:text-slate-100"
                    : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {/* Scope filter */}
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-slate-700/50 dark:bg-slate-800/50">
            {(["all", "platform", "project"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setScopeFilter(f)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  scopeFilter === f
                    ? "bg-gray-900 text-white dark:bg-slate-700 dark:text-slate-100"
                    : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {f === "all" ? "All scopes" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-400 dark:text-slate-500">
            {sorted.length} grant{sorted.length !== 1 ? "s" : ""}
          </span>
        </div>
        {onGrantAccess && (
          <button
            onClick={onGrantAccess}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            + Grant access
          </button>
        )}
      </div>

      {/* Grants table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-slate-800 dark:bg-slate-900/80">
              <th className="px-4 py-2 font-semibold text-gray-500 dark:text-slate-400">Subject</th>
              <th className="px-4 py-2 font-semibold text-gray-500 dark:text-slate-400">Preset</th>
              <th className="px-4 py-2 font-semibold text-gray-500 dark:text-slate-400">Scope</th>
              <th className="px-4 py-2 font-semibold text-gray-500 dark:text-slate-400">Status</th>
              <th className="px-4 py-2 font-semibold text-gray-500 dark:text-slate-400">Granted</th>
              <th className="px-4 py-2 font-semibold text-gray-500 dark:text-slate-400">Expires</th>
              <th className="px-4 py-2 font-semibold text-gray-500 dark:text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
            {sorted.map((grant) => {
              const state = getAccessGrantVisualState(grant);
              const subjectLabel = grant.subject?.name ?? grant.subject?.email ?? grant.subjectUserId;

              return (
                <tr
                  key={grant.id}
                  className={`transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/30 ${state !== "active" ? "opacity-60" : ""}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="block truncate font-medium text-gray-900 dark:text-slate-200">
                        {subjectLabel}
                      </span>
                      {grant.subject?.name && grant.subject?.email && (
                        <span className="block truncate text-[11px] text-gray-500 dark:text-slate-500">
                          {grant.subject.email}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <AccessGrantBadge
                      presetKey={grant.sourcePresetKey}
                      customLabel={grant.customLabel}
                      state={state}
                      compact
                    />
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">
                    {grant.scope.type === "platform" ? (
                      <span className="text-gray-400 dark:text-slate-500">Platform</span>
                    ) : (
                      <span>{grant.scope.projectName ?? grant.scope.projectId}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                      state === "active" ? "text-emerald-600 dark:text-emerald-400" :
                      state === "expired" ? "text-gray-400 dark:text-slate-500" :
                      "text-rose-500 dark:text-rose-400"
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        state === "active" ? "bg-emerald-500 dark:bg-emerald-400" :
                        state === "expired" ? "bg-gray-400 dark:bg-slate-500" :
                        "bg-rose-500 dark:bg-rose-400"
                      }`} />
                      {state}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500">
                    {new Date(grant.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500">
                    {grant.expiresAt
                      ? new Date(grant.expiresAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {state === "active" && (
                      <RevokeAccessGrantButton grantId={grant.id} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-slate-500">
          No grants match the current filters.
        </div>
      )}
    </div>
  );
}
