import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { notFound, redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { PROJECT_FACING_AGENT_LOOP_INCLUDE } from "@/lib/project-facing-agent-loops";
import {
  isManagedProviderCreditsEnabled,
  isByokProviderKeysEnabled,
} from "@/lib/feature-flags";
import { resolvePlatformAccess } from "@/lib/platform-access";
import { getProjectInteractionSnapshotForViewer } from "@/lib/project-interaction";
import { parseProjectInteractionFocus } from "@/lib/project-interaction-deeplink";
import {
  getProjectAccessPanelState,
  listAccessSubjects,
  listProjectAccessSubjects,
} from "@/lib/access-control/server";
import {
  ProjectInteractionActivitySection,
  ProjectInteractionAssumptionsSection,
  ProjectInteractionAssetsSection,
  ProjectInteractionBackLink,
  ProjectInteractionFeedbackSection,
  ProjectInteractionHeader,
  ProjectInteractionMacBuildSection,
  ProjectInteractionManagerNav,
  ProjectInteractionPreviewSection,
  ProjectInteractionSecretsSection,
  ProjectInteractionSettingsSection,
  ProjectInteractionSpecsSection,
  ProjectInteractionStatusSection,
  ProjectInteractionTasksSection,
  ProjectInteractionVisualEvidenceSection,
  type ProjectInteractionLaunchConfig,
} from "@/components/project-interaction/ProjectInteractionBlocks";
import {
  PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM,
} from "@/lib/project-update-outbox";
import { listTgSpecManagerBindingCandidates } from "@/lib/tg-spec-manager-bindings";
import {
  TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED,
  TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED,
  getTgSpecLaunchConfigurationState,
} from "@/lib/tg-spec-target";

interface DashboardProjectDetailProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function getProjectPageConfig(id: string) {
  return (prisma as any).project.findUnique({
    where: { id },
    select: {
      id: true,
      agent: true,
      agentImpl: true,
      model: true,
      claudeAuthMode: true,
      codexAuthMode: true,
      runnerBackend: true,
      providerBillingMode: true,
      repoUrl: true,
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          kind: true,
          sourceConfig: true,
          runtimeConfig: true,
        },
      },
      proposal: {
        select: { description: true },
      },
    },
  });
}

async function getManagerDeliveryTargetState(projectId: string, enabled: boolean) {
  if (!enabled) return null;

  const [targets, tgSpecBindings] = await Promise.all([
    prisma.projectUpdateDeliveryTarget.findMany({
      where: {
        projectId,
        sourceSystem: PROJECT_UPDATE_DELIVERY_TARGET_SOURCE_SYSTEM,
        audience: "project_managers",
      },
      orderBy: [
        { status: "asc" },
        { activatedAt: "desc" },
        { updatedAt: "desc" },
      ],
      take: 6,
      select: {
        id: true,
        sourceTargetId: true,
        targetKind: true,
        status: true,
        label: true,
        requiredCapability: true,
        activatedAt: true,
        revokedAt: true,
        updatedAt: true,
      },
    }),
    listTgSpecManagerBindingCandidates(projectId),
  ]);

  const viewTargets = targets.map((target) => ({
    id: target.id,
    sourceTargetId: target.sourceTargetId,
    targetKind: target.targetKind,
    status: target.status,
    label: target.label,
    requiredCapability: target.requiredCapability,
    activatedAt: target.activatedAt?.toISOString() ?? null,
    revokedAt: target.revokedAt?.toISOString() ?? null,
    updatedAt: target.updatedAt.toISOString(),
  }));

  return {
    activeTarget: viewTargets.find((target) => target.status === "ACTIVE") ?? null,
    recentTargets: viewTargets,
    tgSpecBindings,
  };
}

export default async function DashboardProjectDetailPage({
  params,
  searchParams,
}: DashboardProjectDetailProps) {
  const { id } = await params;
  const [
    session,
    hasBypass,
    projectConfig,
    tools,
    agentLoops,
    userProviderCredentialsEnabled,
    managedProviderCreditsEnabled,
    rawSearchParams,
  ] = await Promise.all([
    auth(),
    hasE2EAdminBypass(),
    getProjectPageConfig(id),
    (prisma as any).tool.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    (prisma as any).agentLoop.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: PROJECT_FACING_AGENT_LOOP_INCLUDE,
    }),
    isByokProviderKeysEnabled(),
    isManagedProviderCreditsEnabled(),
    searchParams,
  ]);

  if (!session?.user && !hasBypass) {
    redirect("/");
  }

  const snapshotResult = await getProjectInteractionSnapshotForViewer({
    projectId: id,
    session,
    hasBypass,
  });

  if (snapshotResult.status === "unauthorized") {
    redirect("/");
  }
  if (snapshotResult.status !== "ok" || !projectConfig) {
    notFound();
  }

  const snapshot = snapshotResult.snapshot;
  const focus = parseProjectInteractionFocus(rawSearchParams);
  const projectDescription = projectConfig.proposal?.description?.trim() || null;
  const primaryComponent = projectConfig.components?.[0] ?? null;
  const runtimeConfig =
    primaryComponent &&
    primaryComponent.runtimeConfig &&
    typeof primaryComponent.runtimeConfig === "object"
      ? (primaryComponent.runtimeConfig as Record<string, unknown>)
      : null;
  const simpleRelaunchMode =
    snapshot.specs.length === 0 &&
    typeof runtimeConfig?.commandTemplate === "string";
  const platformAccess = await resolvePlatformAccess(session, hasBypass);
  const allowPlatformCredentials =
    platformAccess.hasCapability("platform.projects.manage")
    || platformAccess.hasCapability("platform.runtime.manage");
  const allowManagedVps = platformAccess.hasCapability("platform.runtime.manage");
  const canManagePlatformAccess = platformAccess.hasCapability("platform.access.manage");
  const [projectAccessPanelState, accessSubjects] = snapshot.viewer.sections.access
    ? await Promise.all([
      getProjectAccessPanelState(id, { includeInheritedSources: canManagePlatformAccess }),
      canManagePlatformAccess ? listAccessSubjects() : listProjectAccessSubjects(id),
    ])
    : [null, []];
  const managerDeliveryTargetState = await getManagerDeliveryTargetState(
    id,
    snapshot.viewer.allowedActions.manageAccess,
  );
  const userCreditBalance = session?.user?.id
    ? (await prisma.userCreditBalance.findUnique({
      where: { userId: session.user.id },
      select: { credits: true },
    }))?.credits ?? 0
    : 0;
  const tgSpecLaunchConfiguration = getTgSpecLaunchConfigurationState(primaryComponent?.sourceConfig);
  const launchConfig: ProjectInteractionLaunchConfig = {
    currentAgent: projectConfig.agent,
    currentAgentImpl: projectConfig.agentImpl,
    currentModel: projectConfig.model,
    currentClaudeAuthMode: projectConfig.claudeAuthMode,
    currentCodexAuthMode: projectConfig.codexAuthMode,
    currentRunnerBackend: projectConfig.runnerBackend,
    tools,
    agentLoops,
    simpleRelaunchMode,
    allowCookieAutoconfirm: true,
    allowPlatformCredentials,
    allowManagedVps,
    userProviderCredentialsEnabled,
    managedProviderCreditsEnabled,
    currentProviderBillingMode: projectConfig.providerBillingMode,
    tgSpecLaunchConfigurationState:
      tgSpecLaunchConfiguration === TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED
        ? "required"
        : tgSpecLaunchConfiguration === TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED
          ? "configured"
          : null,
    userCreditBalance,
  };

  return (
    <main className="min-h-screen bg-white py-8 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3">
            <ProjectInteractionBackLink />
            <ThemeToggle />
          </div>
        </div>

        <ProjectInteractionHeader
          snapshot={snapshot}
          description={projectDescription}
          repoUrl={projectConfig.repoUrl}
          launchConfig={launchConfig}
        />
        <ProjectInteractionManagerNav
          snapshot={snapshot}
          launchConfig={launchConfig}
          focus={focus}
        />
        <ProjectInteractionPreviewSection snapshot={snapshot} />
        <ProjectInteractionMacBuildSection snapshot={snapshot} />
        <ProjectInteractionTasksSection snapshot={snapshot} />
        <ProjectInteractionVisualEvidenceSection
          snapshot={snapshot}
          focus={focus?.section === "visualEvidence" ? focus : null}
        />
        <ProjectInteractionFeedbackSection snapshot={snapshot} />
        <ProjectInteractionAssumptionsSection snapshot={snapshot} />
        <ProjectInteractionSpecsSection snapshot={snapshot} />
        <ProjectInteractionAssetsSection snapshot={snapshot} />
        <ProjectInteractionSecretsSection
          snapshot={snapshot}
          launchConfig={launchConfig}
          focus={focus?.section === "secrets" ? focus : null}
        />
        <ProjectInteractionStatusSection snapshot={snapshot} />
        <ProjectInteractionActivitySection snapshot={snapshot} />
        <ProjectInteractionSettingsSection
          snapshot={snapshot}
          canFeatureProject={platformAccess.hasCapability("platform.projects.manage")}
          accessPanelState={projectAccessPanelState}
          accessSubjects={accessSubjects}
          managerDeliveryTargetState={managerDeliveryTargetState}
        />
      </div>
    </main>
  );
}
