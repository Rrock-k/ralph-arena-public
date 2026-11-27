"use client";

import { useState } from "react";
import type { AccessAuditEntry, AccessAuditAction } from "@/lib/access-control/types";
import { ACCESS_PRESET_DEFINITIONS } from "@/lib/access-control/presets";

interface AuditSubViewProps {
  entries: AccessAuditEntry[];
}

const ACTION_CONFIG: Record<AccessAuditAction, { label: string; color: string; icon: string }> = {
  grant_created: {
    label: "Created",
    color: "text-emerald-600 dark:text-emerald-400",
    icon: "+",
  },
  grant_updated: {
    label: "Modified",
    color: "text-sky-600 dark:text-sky-400",
    icon: "~",
  },
  grant_revoked: {
    label: "Revoked",
    color: "text-rose-600 dark:text-rose-400",
    icon: "×",
  },
  grant_expired: {
    label: "Expired",
    color: "text-gray-400 dark:text-slate-400",
    icon: "○",
  },
};

function getAuditSourceLabel(sourceKind: AccessAuditEntry["sourceKind"]): string {
  return sourceKind === "telegram_admin_sync" ? "Telegram sync" : "Manual";
}

export function AuditSubView({ entries }: AuditSubViewProps) {
  const [actionFilter, setActionFilter] = useState<"all" | AccessAuditAction>("all");

  const filtered = actionFilter === "all"
    ? entries
    : entries.filter((e) => e.action === actionFilter);

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-slate-700/50 dark:bg-slate-800/50">
          <button
            onClick={() => setActionFilter("all")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              actionFilter === "all" ? "bg-gray-900 text-white dark:bg-slate-700 dark:text-slate-100" : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            All
          </button>
          {(Object.keys(ACTION_CONFIG) as AccessAuditAction[]).map((action) => (
            <button
              key={action}
              onClick={() => setActionFilter(action)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                actionFilter === action ? "bg-gray-900 text-white dark:bg-slate-700 dark:text-slate-100" : "text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {ACTION_CONFIG[action].label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {sorted.length} event{sorted.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {sorted.map((entry, idx) => {
          const config = ACTION_CONFIG[entry.action];
          const presetLabel = entry.sourcePresetKey
            ? ACCESS_PRESET_DEFINITIONS[entry.sourcePresetKey]?.label
            : "Custom";
          const scopeLabel = entry.scope.type === "platform"
            ? "platform"
            : entry.scope.projectName ?? entry.scope.projectId ?? "project";
          const subjectLabel = entry.subject.name ?? entry.subject.email ?? entry.subject.id;
          const actorLabel = entry.actor
            ? entry.actor.name ?? entry.actor.email ?? entry.actor.id ?? "unknown"
            : null;

          return (
            <div key={entry.id} className="flex gap-3 py-2.5">
              {/* Timeline line and dot */}
              <div className="flex w-5 shrink-0 flex-col items-center">
                <div className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                  entry.action === "grant_created" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                  entry.action === "grant_revoked" ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" :
                  entry.action === "grant_updated" ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" :
                  "bg-gray-500/15 text-gray-400 dark:bg-slate-500/15 dark:text-slate-400"
                }`}>
                  {config.icon}
                </div>
                {idx < sorted.length - 1 && (
                  <div className="mt-1 w-px flex-1 bg-gray-200 dark:bg-slate-800" />
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 pb-2">
                <div className="flex items-baseline gap-2">
                  <span className={`text-xs font-semibold ${config.color}`}>
                    {config.label}
                  </span>
                  <span className="text-xs text-gray-900 dark:text-slate-200">
                    {presetLabel}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-slate-500">
                    for {subjectLabel}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-slate-600">
                    on {scopeLabel}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400 dark:text-slate-600">
                  <span>
                    {actorLabel ? `by ${actorLabel}` : "auto"}
                  </span>
                  <span>·</span>
                  <span>{getAuditSourceLabel(entry.sourceKind)}</span>
                  <span>·</span>
                  <span>
                    {formatRelativeTime(new Date(entry.occurredAt))}
                  </span>
                </div>
                {entry.note && (
                  <p className="mt-1 text-[11px] text-gray-500 italic dark:text-slate-500">
                    {entry.note}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sorted.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-slate-500">
          No audit events match the current filter.
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
