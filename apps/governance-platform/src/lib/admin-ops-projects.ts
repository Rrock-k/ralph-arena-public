import "server-only";

import { prisma } from "@/lib/prisma";
import { parseRequiredSecrets } from "@/lib/required-secrets";
import { resolveProjectAccessMap } from "@/lib/project-access";
import { getPreferredPreviewUrl } from "@/lib/preview-url";
import { resolveLoopSupport, runtimeConfigUsesRepoHead } from "@/lib/loop-support";
import { getPrimaryLifecycleComponent, getPublicDisplayStatus } from "@/lib/project-lifecycle";
import { getTgSpecLaunchConfigurationState } from "@/lib/tg-spec-target";
import { readVisualEvidenceModeReadback } from "@/lib/visual-workbench-runtime-config";
import type { Session } from "next-auth";

const ADMIN_OPS_RUN_LOG_LIMIT = 20;
const ADMIN_OPS_RUN_LOG_BATCH_SIZE = 8;

type AdminOpsRunLog = {
  id: string;
  projectId: string;
  event: string;
  detail: string | null;
  createdAt: Date;
};

const RUN_LOG_SELECT = {
  id: true,
  projectId: true,
  event: true,
  detail: true,
  createdAt: true,
} as const;

async function getRecentRunLogsByProject(projectIds: string[]): Promise<Map<string, Omit<AdminOpsRunLog, "projectId">[]>> {
  const logsByProject = new Map<string, Omit<AdminOpsRunLog, "projectId">[]>();
  if (projectIds.length === 0) return logsByProject;

  for (let i = 0; i < projectIds.length; i += ADMIN_OPS_RUN_LOG_BATCH_SIZE) {
    const batch = projectIds.slice(i, i + ADMIN_OPS_RUN_LOG_BATCH_SIZE);
    const entries = await Promise.all(batch.map(async (projectId) => {
      const logs = await prisma.runLog.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: ADMIN_OPS_RUN_LOG_LIMIT,
        select: RUN_LOG_SELECT,
      });
      return [
        projectId,
        logs.map(({ projectId: _projectId, ...log }) => log),
      ] as const;
    }));

    for (const [projectId, logs] of entries) {
      logsByProject.set(projectId, logs);
    }
  }

  return logsByProject;
}

export async function getAdminOpsRawProjects(projectIds?: string[]) {
  const where = projectIds?.length
    ? { id: { in: projectIds } }
    : undefined;

  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      mode: true,
      ownerScopeType: true,
      ownerScopeId: true,
      archivedAt: true,
      agent: true,
      agentImpl: true,
      model: true,
      providerBillingMode: true,
      toolId: true,
      agentLoopVersionId: true,
      runnerBackend: true,
      isPinned: true,
      visibility: true,
      showAiDisclaimer: true,
      exploreRank: true,
      createdAt: true,
      updatedAt: true,
      estimatedCostUsd: true,
      inputTokens: true,
      outputTokens: true,
      repoUrl: true,
      repoBranch: true,
      commitSha: true,
      claudeAuthMode: true,
      codexAuthMode: true,
      progressJson: true,
      requiredSecrets: true,
      proposal: { select: { id: true, title: true, description: true } },
      agentLoopVersion: {
        select: {
          version: true,
          supportTier: true,
          agentLoop: {
            select: {
              name: true,
            },
          },
        },
      },
      secrets: {
        orderBy: { key: "asc" },
        select: {
          id: true,
          key: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      budget: true,
      components: {
        orderBy: { createdAt: "asc" as const },
        take: 1,
        select: {
          kind: true,
          powerIntent: true,
          agentIntent: true,
          runtimeState: true,
          agentState: true,
          blockers: true,
          lastOutcome: true,
          previewHealth: true,
          previewCheckedAt: true,
          retryAt: true,
          retryCount: true,
          provisionedAt: true,
          containerName: true,
          previewUrl: true,
          workerHost: true,
          lastHeartbeat: true,
          sourceConfig: true,
          runtimeConfig: true,
        },
      },
      vpsHost: {
        select: {
          id: true,
          status: true,
          ip: true,
          previewDomain: true,
          region: true,
          serverType: true,
        },
      },
      specs: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          title: true,
          content: true,
          orderIndex: true,
        },
      },
      assets: {
        where: { deletedAt: null },
        orderBy: { path: "asc" },
        select: {
          id: true,
          path: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          uploadedById: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      events: {
        where: { type: { in: ["context_question", "context_answer"] } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          direction: true,
          type: true,
          payload: true,
          createdAt: true,
        },
      },
    },
  });

  const logsByProject = await getRecentRunLogsByProject(projects.map((project) => project.id));
  return projects.map((project) => ({
    ...project,
    runLogs: logsByProject.get(project.id) ?? [],
  }));
}

export async function buildAdminOpsProjects(
  rawProjects: Awaited<ReturnType<typeof getAdminOpsRawProjects>>,
  session: Session | null,
  hasBypass: boolean,
) {
  const accessByProjectId = await resolveProjectAccessMap(
    rawProjects.map((project) => ({
      id: project.id,
      mode: project.mode,
      visibility: project.visibility,
      ownerScopeType: project.ownerScopeType,
      ownerScopeId: project.ownerScopeId,
    })),
    session,
    hasBypass,
  );

  return rawProjects.map((project) => {
    const rawApp = getPrimaryLifecycleComponent(project);
    const previewUrl = getPreferredPreviewUrl({
      previewUrl: rawApp?.previewUrl ?? null,
      containerName: rawApp?.containerName ?? null,
      previewDomain: project.vpsHost?.previewDomain ?? process.env.PREVIEW_DOMAIN?.trim() ?? null,
    });
    const components = project.components?.map((component, index) => (
      index === 0
        ? {
          ...component,
          previewUrl,
        }
        : component
    )) ?? [];
    const comp = getPrimaryLifecycleComponent({ components });
    const access = accessByProjectId[project.id];
    const canViewProject = access?.canView === true;
    const useRepoHead = runtimeConfigUsesRepoHead(comp?.runtimeConfig ?? null);
    const visualEvidenceModeReadback = readVisualEvidenceModeReadback(comp?.runtimeConfig ?? null);
    const loopSupport = resolveLoopSupport({
      agentImpl: project.agentImpl,
      loopName: project.agentLoopVersion?.agentLoop?.name ?? null,
      loopVersion: project.agentLoopVersion?.version ?? null,
      supportTier: project.agentLoopVersion?.supportTier ?? null,
      useRepoHead,
      hasLoopVersion: Boolean(project.agentLoopVersion),
    });
    return {
      ...project,
      components,
      contextQuestionEvents: canViewProject ? project.events : [],
      requiredSecrets: parseRequiredSecrets(project.requiredSecrets),
      status: getPublicDisplayStatus({ archivedAt: project.archivedAt, components }),
      lastOutcome: comp?.lastOutcome,
      useRepoHead,
      loopVersion: project.agentLoopVersion?.version ?? null,
      loopName: project.agentLoopVersion?.agentLoop?.name ?? null,
      loopSupportTier: project.agentLoopVersion?.supportTier ?? null,
      loopRuntime: loopSupport.loopIdentity,
      loopSupportStatus: loopSupport.supportStatus,
      loopSupportLabel: loopSupport.supportLabel,
      loopSupportHint: loopSupport.supportHint,
      ...visualEvidenceModeReadback,
      appStartAllowed: loopSupport.appStartAllowed,
      agentStartAllowed: loopSupport.agentStartAllowed,
      relaunchAllowed: loopSupport.relaunchAllowed,
      accessCapabilities: access?.effectiveCapabilities ?? [],
    };
  });
}

export type AdminOpsProject = Awaited<ReturnType<typeof buildAdminOpsProjects>>[number];

export type ProjectOperatorSnapshot = {
  id: string;
  name: string;
  archivedAt: Date | null;
  repoUrl: string | null;
  repoBranch: string | null;
  agent: string;
  agentImpl: string;
  model: string | null;
  toolId: string | null;
  agentLoopVersionId: string | null;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
  providerBillingMode: string | null;
  budget: {
    isEnabled: boolean;
  } | null;
  app: {
    powerIntent: string | null;
    agentIntent: string | null;
    runtimeState: string | null;
    agentState: string | null;
    blockers: string[];
    lastOutcome: string | null;
    previewHealth: string | null;
    previewUrl: string | null;
    retryAt: Date | null;
    retryCount: number;
    provisionedAt: Date | null;
    containerName: string | null;
    workerHost: string | null;
    lastHeartbeat: Date | null;
  } | null;
  loopRuntime: string | null;
  loopSupportStatus: "supported" | "upgrade-required" | "unsupported" | null;
  loopSupportLabel: string | null;
  loopSupportHint: string | null;
  visualEvidenceMode: ReturnType<typeof readVisualEvidenceModeReadback>["visualEvidenceMode"];
  visualEvidenceModeError: string | null;
  appStartAllowed: boolean;
  agentStartAllowed: boolean;
  relaunchAllowed: boolean;
  tgSpecLaunchConfiguration: ReturnType<typeof getTgSpecLaunchConfigurationState>;
};

export function buildProjectOperatorSnapshot(project: AdminOpsProject): ProjectOperatorSnapshot {
  const component = getPrimaryLifecycleComponent(project);

  return {
    id: project.id,
    name: project.name,
    archivedAt: project.archivedAt,
    repoUrl: project.repoUrl,
    repoBranch: project.repoBranch,
    agent: project.agent,
    agentImpl: project.agentImpl,
    model: project.model,
    toolId: project.toolId,
    agentLoopVersionId: project.agentLoopVersionId,
    claudeAuthMode: project.claudeAuthMode,
    codexAuthMode: project.codexAuthMode,
    providerBillingMode: project.providerBillingMode,
    budget: project.budget
      ? {
        isEnabled: project.budget.isEnabled,
      }
      : null,
    app: component
      ? {
        powerIntent: component.powerIntent ?? null,
        agentIntent: component.agentIntent ?? null,
        runtimeState: component.runtimeState ?? null,
        agentState: component.agentState ?? null,
        blockers: Array.isArray(component.blockers) ? component.blockers : [],
        lastOutcome: component.lastOutcome ?? null,
        previewHealth: component.previewHealth ?? null,
        previewUrl: component.previewUrl ?? null,
        retryAt: component.retryAt ?? null,
        retryCount: component.retryCount ?? 0,
        provisionedAt: component.provisionedAt ?? null,
        containerName: component.containerName ?? null,
        workerHost: component.workerHost ?? null,
        lastHeartbeat: component.lastHeartbeat ?? null,
      }
      : null,
    loopRuntime: project.loopRuntime ?? null,
    loopSupportStatus: project.loopSupportStatus ?? null,
    loopSupportLabel: project.loopSupportLabel ?? null,
    loopSupportHint: project.loopSupportHint ?? null,
    visualEvidenceMode: project.visualEvidenceMode,
    visualEvidenceModeError: project.visualEvidenceModeError ?? null,
    appStartAllowed: project.appStartAllowed ?? true,
    agentStartAllowed: project.agentStartAllowed ?? false,
    relaunchAllowed: project.relaunchAllowed ?? false,
    tgSpecLaunchConfiguration: getTgSpecLaunchConfigurationState(component?.sourceConfig ?? null),
  };
}

export async function getProjectOperatorSnapshotForViewer(options: {
  projectId: string;
  session: Session | null;
  hasBypass: boolean;
}) {
  const projects = await getAdminOpsProjectsForViewer({
    projectIds: [options.projectId],
    session: options.session,
    hasBypass: options.hasBypass,
  });
  const project = projects[0];
  if (!project) {
    return null;
  }
  return buildProjectOperatorSnapshot(project);
}

export async function getAdminOpsProjectsForViewer(options: {
  projectIds?: string[];
  session: Session | null;
  hasBypass: boolean;
}) {
  const rawProjects = await getAdminOpsRawProjects(options.projectIds);
  return buildAdminOpsProjects(rawProjects, options.session, options.hasBypass);
}
