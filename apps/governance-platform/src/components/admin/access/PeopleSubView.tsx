"use client";

import { useState } from "react";
import type { AccessPeopleRow } from "@/lib/access-control/types";
import { getAccessGrantVisualState } from "@/lib/access-control/utils";
import { AccessGrantBadge } from "./AccessGrantBadge";

interface PeopleSubViewProps {
  rows: AccessPeopleRow[];
  onGrantAccess?: () => void;
}

export function PeopleSubView({ rows, onGrantAccess }: PeopleSubViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active">("all");

  const filtered = rows.filter((row) => {
    if (filter === "active") return row.activeGrantCount > 0;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-slate-700/50 dark:bg-slate-800/50">
            {(["all", "active"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === f
                    ? "bg-gray-900 text-white dark:bg-slate-700 dark:text-slate-100"
                    : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {f === "all" ? "All" : "With grants"}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-400 dark:text-slate-500">
            {filtered.length} {filtered.length === 1 ? "person" : "people"}
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

      {/* People list */}
      <div className="space-y-1">
        {filtered.map((row) => {
          const isExpanded = expandedId === row.subject.id;
          const subjectLabel = row.subject.name ?? row.subject.email ?? row.subject.id;
          return (
            <div
              key={row.subject.id}
              className="rounded-lg border border-gray-200 bg-white transition-colors hover:border-gray-300 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-slate-700"
            >
              {/* Row header */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : row.subject.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
              >
                {/* Avatar */}
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                  {subjectLabel[0].toUpperCase()}
                </div>

                {/* Name and email */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-slate-200">
                      {subjectLabel}
                    </span>
                    {row.subject.name && row.subject.email && (
                      <span className="truncate text-xs text-gray-500 dark:text-slate-500">{row.subject.email}</span>
                    )}
                  </div>
                </div>

                {/* Summary pills */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {row.summaryPills.map((pill, i) => (
                    <AccessGrantBadge
                      key={i}
                      presetKey={null}
                      customLabel={pill}
                      sourceKind="direct"
                      compact
                    />
                  ))}
                  {row.activeGrantCount === 0 && (
                    <span className="text-[10px] text-gray-400 dark:text-slate-600">no active access</span>
                  )}
                </div>

                {/* Expand chevron */}
                <svg
                  className={`h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-slate-500 ${isExpanded ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-gray-200 px-4 py-3 space-y-3 dark:border-slate-800">
                  {/* Direct grants */}
                  {row.directGrants.length > 0 && (
                    <div>
                      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
                        Direct grants
                      </h4>
                      <div className="space-y-1.5">
                        {row.directGrants.map((grant) => {
                          const state = getAccessGrantVisualState(grant);
                          return (
                            <div key={grant.id} className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <AccessGrantBadge
                                  presetKey={grant.sourcePresetKey}
                                  customLabel={grant.customLabel}
                                  state={state}
                                  sourceKind="direct"
                                  compact
                                />
                                {grant.scope.type === "project" && (
                                  <span className="text-gray-500 dark:text-slate-500">
                                    on {grant.scope.projectName ?? grant.scope.projectId}
                                  </span>
                                )}
                                {grant.scope.type === "platform" && (
                                  <span className="text-gray-500 dark:text-slate-500">platform-wide</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-gray-400 dark:text-slate-600">
                                {grant.expiresAt && state === "active" && (
                                  <span>
                                    expires {new Date(grant.expiresAt).toLocaleDateString()}
                                  </span>
                                )}
                                {grant.revokedAt && (
                                  <span className="text-rose-500/70 dark:text-rose-400/70">
                                    revoked {new Date(grant.revokedAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Inherited access */}
                  {row.inheritedSources.length > 0 && (
                    <div>
                      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
                        Inherited
                      </h4>
                      <div className="space-y-1">
                        {row.inheritedSources.map((source, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-500">
                            <span className="h-1 w-1 rounded-full bg-gray-400 dark:bg-slate-600" />
                            <span>{source.label}</span>
                            <span className="text-gray-400 dark:text-slate-600">
                              ({source.capabilities.length} capabilities)
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Effective capabilities */}
                  {row.effectiveCapabilities.length > 0 && (
                    <div>
                      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-500">
                        Effective capabilities ({row.effectiveCapabilities.length})
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {row.effectiveCapabilityEntries.map((entry) => (
                          <span
                            key={entry.capability}
                            className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500 dark:border-slate-700/50 dark:bg-slate-800/50 dark:text-slate-400"
                            title={`via: ${entry.grantedVia.join(", ")}`}
                          >
                            {entry.capability}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-slate-500">
          No people match this filter.
        </div>
      )}
    </div>
  );
}
