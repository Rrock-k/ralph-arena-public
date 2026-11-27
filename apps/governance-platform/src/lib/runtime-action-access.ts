import { requirePlatformCapability, resolvePlatformAccess } from "@/lib/platform-access";
import { requireProjectCapability } from "@/lib/project-access";
import { prisma } from "@/lib/prisma";
import { enforceRequiredProjectBudget } from "@/lib/project-budget";
import { enforceUserLaunchPolicy } from "@/lib/user-launch-policy";

type RuntimeActionGuardResult = { success: false; error: string } | null;

export async function requireProjectRuntimeActionAccess(projectId: string): Promise<RuntimeActionGuardResult> {
  const [platformAccess, projectAccess] = await Promise.all([
    requirePlatformCapability("platform.runtime.manage"),
    requireProjectCapability(projectId, "project.runtime.manage"),
  ]);

  if (platformAccess.authorized) {
    return null;
  }
  if (!projectAccess.authorized) {
    return { success: false, error: projectAccess.error ?? platformAccess.error };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      runnerBackend: true,
      ownerScopeType: true,
      ownerScopeId: true,
      agent: true,
      agentImpl: true,
      providerBillingMode: true,
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { vpsHostId: true },
      },
    },
  });

  const component = project?.components?.[0] ?? null;
  if ((project?.runnerBackend ?? "local") === "vps" || component?.vpsHostId) {
    return {
      success: false,
      error: "Managed VPS runtime actions require platform runtime access.",
    };
  }

  if (project?.ownerScopeType === "user") {
    const currentPlatformAccess = await resolvePlatformAccess(projectAccess.session, projectAccess.hasBypass);
    const policy = await enforceUserLaunchPolicy({
      userId: project.ownerScopeId,
      privileged:
        currentPlatformAccess.hasCapability("platform.projects.manage")
        || currentPlatformAccess.hasCapability("platform.runtime.manage"),
      agent: project.agent,
      agentImpl: project.agentImpl,
      runnerBackend: project.runnerBackend,
      providerBillingMode: project.providerBillingMode,
    });
    if (!policy.allowed) {
      return { success: false, error: policy.error };
    }

    if (project.providerBillingMode === "platform_credits") {
      const budgetGuard = await enforceRequiredProjectBudget(projectId);
      if (!budgetGuard.allowed) {
        return { success: false, error: budgetGuard.error ?? "Insufficient project budget." };
      }
    }
  }

  return null;
}
