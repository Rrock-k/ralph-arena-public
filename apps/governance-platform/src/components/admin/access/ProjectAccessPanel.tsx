"use client";

import { useState } from "react";
import type {
  AccessSubjectSummary,
  ProjectAccessPanelState,
} from "@/lib/access-control/types";
import {
  getAccessGrantLabel,
  getAccessGrantVisualState,
} from "@/lib/access-control/utils";
import { AccessGrantBadge } from "./AccessGrantBadge";
import { GrantAccessDialog } from "./GrantAccessDialog";
import { RevokeAccessGrantButton } from "./RevokeAccessGrantButton";

interface ProjectAccessPanelProps {
  state: ProjectAccessPanelState;
  subjects: AccessSubjectSummary[];
  projectScopedProjectId?: string;
}

function getSubjectLabel(subject: AccessSubjectSummary | null, fallback: string): string {
  return subject?.name ?? subject?.email ?? fallback;
}

function formatShortDate(value: string): string {
  return value.slice(0, 10);
}

function getGrantSourceLabel(sourceKind: ProjectAccessPanelState["directGrants"][number]["sourceKind"]): string {
  return sourceKind === "telegram_admin_sync" ? "Telegram sync" : "Manual";
}

export function ProjectAccessPanel({
  state,
  subjects,
  projectScopedProjectId,
}: ProjectAccessPanelProps) {
  const [showGrantDialog, setShowGrantDialog] = useState(false);

  const activeGrants = state.directGrants.filter((grant) => getAccessGrantVisualState(grant) === "active");
  const ownerLabel = state.owner ? getSubjectLabel(state.owner, state.owner.id) : null;

  return (
    <div className="space-y-3">
      {state.owner && ownerLabel && (
        <div className="flex items-center justify-between text-xs">
          <div className="min-w-0">
            <span className="block truncate font-medium text-gray-700 dark:text-slate-300">
              {ownerLabel}
            </span>
            {state.owner.name && state.owner.email && (
              <span className="block truncate text-[10px] text-gray-400 dark:text-slate-600">
                {state.owner.email}
              </span>
            )}
          </div>
          <AccessGrantBadge
            presetKey={null}
            customLabel="Owner"
            sourceKind="owner"
            compact
          />
        </div>
      )}

      {/* Direct grants */}
      {activeGrants.length > 0 ? (
        <div className="space-y-1.5">
          {activeGrants.map((grant) => {
            const subjectLabel = getSubjectLabel(grant.subject, grant.subjectUserId);
            return (
              <div
                key={grant.id}
                className="flex items-center justify-between text-xs"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <div className="min-w-0">
                    <span className="block truncate font-medium text-gray-700 dark:text-slate-300">
                      {subjectLabel}
                    </span>
                    {grant.subject?.name && grant.subject?.email && (
                      <span className="block truncate text-[10px] text-gray-400 dark:text-slate-600">
                        {grant.subject.email}
                      </span>
                    )}
                  </div>
                  <AccessGrantBadge
                    presetKey={grant.sourcePresetKey}
                    customLabel={getAccessGrantLabel(grant)}
                    sourceKind="direct"
                    compact
                  />
                  <span className="shrink-0 rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-slate-700 dark:text-slate-400">
                    {getGrantSourceLabel(grant.sourceKind)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {grant.lastSyncedAt && (
                    <span className="text-[10px] text-gray-400 dark:text-slate-600">
                      sync {formatShortDate(grant.lastSyncedAt)}
                    </span>
                  )}
                  {grant.expiresAt && (
                    <span className="text-[10px] text-gray-400 dark:text-slate-600">
                      exp {formatShortDate(grant.expiresAt)}
                    </span>
                  )}
                  <RevokeAccessGrantButton
                    grantId={grant.id}
                    compact
                    projectScopedProjectId={projectScopedProjectId}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-slate-600">
          No direct access grants.
        </p>
      )}

      {/* Inherited access */}
      {state.inheritedSources.length > 0 && (
        <div className="space-y-1">
          {state.inheritedSources.map((source, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-slate-500">
              <span className="h-1 w-1 rounded-full bg-gray-400 dark:bg-slate-600" />
              <span>{source.label}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setShowGrantDialog(true)}
        className="w-full rounded-md border border-dashed border-gray-300 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:border-emerald-500/40 hover:text-emerald-600 dark:border-slate-700 dark:text-slate-400 dark:hover:text-emerald-400"
      >
        + Add admin
      </button>

      <GrantAccessDialog
        open={showGrantDialog}
        onOpenChange={setShowGrantDialog}
        subjects={subjects}
        defaultPresetKey="project_manager"
        defaultScopeType="project"
        defaultProjectId={state.scope.projectId}
        defaultProjectName={state.scope.projectName}
        projectScopedProjectId={projectScopedProjectId}
      />
    </div>
  );
}
