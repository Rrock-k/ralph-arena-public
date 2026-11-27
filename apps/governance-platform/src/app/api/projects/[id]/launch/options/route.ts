import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { projectAccessJsonResponse } from "@/lib/project-access-response";
import { PROJECT_FACING_AGENT_LOOP_INCLUDE } from "@/lib/project-facing-agent-loops";
import { requireProjectRuntimeSurfaceCapability } from "@/lib/project-runtime-surface-access";
import { resolvePlatformAccess } from "@/lib/platform-access";
import {
  isByokProviderKeysEnabled,
  isManagedProviderCreditsEnabled,
} from "@/lib/feature-flags";
import {
  TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED,
  TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED,
  getTgSpecLaunchConfigurationState,
} from "@/lib/tg-spec-target";
import { PROJECT_ADDONS } from "@/lib/project-addons";

export const dynamic = "force-dynamic";

const JSON_RESPONSE_INIT = {
  headers: {
    "Cache-Control": "no-store",
  },
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

function launchConfigurationStateLabel(value: string | null) {
  if (value === TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED) return "required";
  if (value === TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED) return "configured";
  return null;
}

async function getProjectLaunchConfig(projectId: string) {
  return (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      agent: true,
      agentImpl: true,
      model: true,
      claudeAuthMode: true,
      codexAuthMode: true,
      runnerBackend: true,
      providerBillingMode: true,
      requiredSecrets: true,
      tgSpecLastImportedVersion: true,
      specs: {
        select: {
          title: true,
          versions: {
            take: 1,
            select: {
              externalSourceSystem: true,
            },
          },
        },
      },
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          sourceConfig: true,
        },
      },
    },
  });
}

function objectConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function selectedProjectAddonIds(projectConfig: NonNullable<Awaited<ReturnType<typeof getProjectLaunchConfig>>>) {
  const sourceConfig = objectConfig(projectConfig.components?.[0]?.sourceConfig);
  const configured = new Set<string>(
    Array.isArray(sourceConfig.addonIds)
      ? sourceConfig.addonIds.filter((entry): entry is string => typeof entry === "string")
      : [],
  );
  const addonSpecTitles = new Set<string>(
    (projectConfig.specs ?? [])
      .filter((spec: { versions: { externalSourceSystem: string | null }[] }) => (
        spec.versions.some((version: { externalSourceSystem: string | null }) => version.externalSourceSystem === "arena")
      ))
      .map((spec: { title: string | null }) => spec.title)
      .filter((title: unknown): title is string => typeof title === "string"),
  );

  return PROJECT_ADDONS
    .filter((addon) => configured.has(addon.id) || addonSpecTitles.has(addon.specTitle))
    .map((addon) => addon.id);
}

export async function GET(request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const access = await requireProjectRuntimeSurfaceCapability(request, projectId, "project.runtime.manage");
  if (!access.authorized) {
    if ("status" in access && access.status === 400) {
      return NextResponse.json({ error: access.error }, { ...JSON_RESPONSE_INIT, status: 400 });
    }
    return projectAccessJsonResponse(access.error);
  }
  if (!access.isOwner && !access.isAdmin) {
    return projectAccessJsonResponse("Project access denied");
  }

  const [
    projectConfig,
    tools,
    agentLoops,
    userProviderCredentialsEnabled,
    managedProviderCreditsEnabled,
    platformAccess,
  ] = await Promise.all([
    getProjectLaunchConfig(projectId),
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
    resolvePlatformAccess(access.session as any, access.hasBypass),
  ]);

  if (!projectConfig) {
    return NextResponse.json({ error: "Project not found" }, { ...JSON_RESPONSE_INIT, status: 404 });
  }

  const userCreditBalance = access.session?.user?.id
    ? (await prisma.userCreditBalance.findUnique({
      where: { userId: access.session.user.id },
      select: { credits: true },
    }))?.credits ?? 0
    : 0;
  const launchConfigurationState = launchConfigurationStateLabel(
    getTgSpecLaunchConfigurationState(projectConfig.components?.[0]?.sourceConfig),
  );
  const allowPlatformCredentials =
    platformAccess.hasCapability("platform.projects.manage")
    || platformAccess.hasCapability("platform.runtime.manage");
  const allowManagedVps = platformAccess.hasCapability("platform.runtime.manage");

  return NextResponse.json({
    projectId,
    hasAcceptedSpec: projectConfig.tgSpecLastImportedVersion != null,
    launchConfigurationState,
    current: {
      agent: projectConfig.agent,
      agentImpl: projectConfig.agentImpl,
      model: projectConfig.model,
      claudeAuthMode: projectConfig.claudeAuthMode,
      codexAuthMode: projectConfig.codexAuthMode,
      runnerBackend: projectConfig.runnerBackend,
      providerBillingMode: projectConfig.providerBillingMode,
      addonIds: selectedProjectAddonIds(projectConfig),
    },
    addons: PROJECT_ADDONS.map((addon) => ({
      id: addon.id,
      label: addon.label,
      description: addon.description,
    })),
    tools,
    agentLoops,
    policy: {
      allowPlatformCredentials,
      allowManagedVps,
      userProviderCredentialsEnabled,
      managedProviderCreditsEnabled,
      userCreditBalance,
    },
  }, JSON_RESPONSE_INIT);
}
