"use client";

import { PreviewCard } from "@/components/ui/project-card/PreviewCard";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { AgentOnButton } from "./AgentOnButton";
import { UnarchiveProjectButton } from "./UnarchiveProjectButton";
import type {
  ProposalWithVotes,
  ProjectSummary,
} from "@/components/ui/project-card/types";
import { getProjectName } from "@/lib/project-identity";
import {
  getAppComponent,
  getOpsDisplayStatus,
  isOpsActiveStatus,
} from "@/lib/operator-display";
import { getRuntimeStartBlockReason } from "./ProjectActions";

interface ProjectsGridProps {
  projects: any[];
  onProjectClick?: (projectId: string) => void;
  canManagePlatformProjects?: boolean;
  canManagePlatformRuntime?: boolean;
  userProviderCredentialsEnabled?: boolean;
  managedProviderCreditsEnabled?: boolean;
}

/** Map admin project data to the shape PreviewCard expects. */
function toProposalProps(project: any): {
  proposal: ProposalWithVotes;
  project: ProjectSummary;
} {
  const app = getAppComponent(project);
  const projectSummary: ProjectSummary = {
    id: project.id,
    archivedAt: project.archivedAt ?? null,
    visibility: project.visibility ?? undefined,
    components: project.components,
    runnerBackend: project.runnerBackend,
    agent: project.agent,
    agentImpl: project.agentImpl,
    model: project.model,
    repoUrl: project.repoUrl ?? null,
    repoBranch: project.repoBranch ?? "main",
    previewUrl: app?.previewUrl ?? null,
    createdAt: project.createdAt,
    containerName: app?.containerName ?? null,
    budget: project.budget ?? null,
  };

  const proposal: ProposalWithVotes = {
    id: project.proposal?.id ?? project.proposalId ?? "",
    title: getProjectName(project),
    description: "",
    status: "APPROVED",
    createdAt: project.createdAt,
    archivedAt: null,
    projects: [projectSummary],
    _count: { votes: 0 },
    votes: [],
  };

  return { proposal, project: projectSummary };
}

function hasProjectCapability(project: any, capability: string): boolean {
  return (
    Array.isArray(project.accessCapabilities) &&
    project.accessCapabilities.includes(capability)
  );
}

export function ProjectsGrid({
  projects,
  onProjectClick,
  canManagePlatformProjects = false,
  canManagePlatformRuntime = false,
  userProviderCredentialsEnabled = false,
  managedProviderCreditsEnabled = false,
}: ProjectsGridProps) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        No projects yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const { proposal, project: projectSummary } = toProposalProps(project);
        const ds = getOpsDisplayStatus(project);
        const hasActiveRun = isOpsActiveStatus(ds);
        const isPaused = ds === "PAUSED";
        const canManageRuntime = hasProjectCapability(
          project,
          "project.runtime.manage",
        );
        const canManageBudget = hasProjectCapability(
          project,
          "project.budget.manage",
        );
        const canDelete = hasProjectCapability(project, "project.delete");
        const runtimeStartBlockReason = getRuntimeStartBlockReason({
          projectId: project.id,
          projectName: getProjectName(project),
          project,
          canManagePlatformProjects,
          canManagePlatformRuntime,
          userProviderCredentialsEnabled,
          managedProviderCreditsEnabled,
        });
        const showAdminOverlay =
          canManageRuntime ||
          canManageBudget ||
          canDelete ||
          canManagePlatformProjects;

        return (
          <div key={project.id} className="relative">
            <PreviewCard
              proposal={proposal}
              project={projectSummary}
              detailHrefOverride={
                onProjectClick
                  ? undefined
                  : `/admin?project=${project.id}&tab=overview`
              }
              onCardClick={
                onProjectClick ? () => onProjectClick(project.id) : undefined
              }
              showBudget={!!project.budget?.isEnabled}
              showBackendBadge={canManagePlatformProjects || canManagePlatformRuntime}
              isAuthenticated={true}
              isAdmin={true}
            />
            {showAdminOverlay && (
              <div
                className="absolute right-3 top-16 z-10 flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                {project.archivedAt && canManageRuntime && (
                  <UnarchiveProjectButton projectId={project.id} />
                )}
                {!project.archivedAt &&
                  !hasActiveRun &&
                  isPaused &&
                  canManageRuntime &&
                  !runtimeStartBlockReason && (
                    <AgentOnButton
                      projectId={project.id}
                      loopRuntime={project.loopRuntime}
                      loopSupportStatus={project.loopSupportStatus}
                      agentStartAllowed={project.agentStartAllowed}
                    />
                  )}
                <ProjectContextMenu
                  projectId={project.id}
                  projectName={getProjectName(project)}
                  project={project}
                  canManagePlatformProjects={canManagePlatformProjects}
                  canManagePlatformRuntime={canManagePlatformRuntime}
                  userProviderCredentialsEnabled={userProviderCredentialsEnabled}
                  managedProviderCreditsEnabled={managedProviderCreditsEnabled}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
