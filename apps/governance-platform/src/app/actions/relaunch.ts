"use server";

import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import {
  enforceRequiredProjectBudget,
  formatBudgetBlockedMessage,
} from "@/lib/project-budget";
import { requireProjectCapability } from "@/lib/project-access";
import { isDisplayActive } from "@/lib/display-status";
import { preLaunchCheck } from "@/lib/project-audit";
import { resolveLoopAndTool } from "@/lib/control-plane";
import { removeContainerInternal } from "@/app/actions/container-ops";
import { getLoopActionBlockMessage, resolveLoopSupport, runtimeConfigUsesRepoHead } from "@/lib/loop-support";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import {
  applyStateChange,
  prepareRuntimeForFreshClaim,
} from "@/lib/project-state-effects";
import { resolvePlatformAccess } from "@/lib/platform-access";
import {
  enforceUserLaunchPolicy,
  normalizeAuthModesForProviderBilling,
  normalizeProviderBillingMode,
  parseProviderBillingMode,
} from "@/lib/user-launch-policy";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

const VALID_CLAUDE_AUTH_MODES = ["oauth", "api_key"] as const;
const VALID_CODEX_AUTH_MODES = ["subscription", "api_key"] as const;
type TransactionClient = Prisma.TransactionClient;
function prismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

type RelaunchOverrides = {
  agent?: string;
  agentImpl?: string;
  model?: string | null;
  envOverrides?: Record<string, string> | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
  runnerBackend?: string | null;
  toolId?: string | null;
  providerBillingMode?: string | null;
};

async function loadRelaunchProject(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      specs: { orderBy: { orderIndex: "asc" } },
      vpsHost: { select: { ip: true } },
    },
  });
}

type LoadedRelaunchProject = NonNullable<Awaited<ReturnType<typeof loadRelaunchProject>>>;
type RelaunchComponent = {
  id?: string | null;
  lastOutcome?: string | null;
  containerName?: string | null;
  runtimeConfig?: unknown;
  sourceConfig?: unknown;
  blockers?: string[] | null;
};

type RelaunchPlan = {
  agent: string;
  agentImpl: string;
  model: string | null;
  providerBillingMode: string;
  needsProvisioning: boolean;
  projectUpdateData: Prisma.ProjectUpdateInput;
  componentConfigUpdate?: {
    componentId: string;
    data: Prisma.ProjectComponentUpdateInput;
  };
};

function getComponentObjectConfig(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function buildRelaunchProjectResetData(): Prisma.ProjectUpdateInput {
  return {
    progressJson: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    budgetDebitedUsd: 0,
    commitSha: null,
    log: null,
  };
}

function getRelaunchBlockedByProjectBlockersMessage(
  primaryComponent: RelaunchComponent | null,
): string | null {
  const blockers = Array.isArray(primaryComponent?.blockers)
    ? primaryComponent.blockers.filter((blocker): blocker is string => typeof blocker === "string" && blocker.length > 0)
    : [];
  if (blockers.length === 0) return null;

  return `Project is waiting on blocker(s): ${blockers.join(", ")}. Use Retry Now when the condition is resolved, or Recreate Runtime for preview/runtime maintenance. Relaunch does not clear blockers.`;
}

async function resolveRelaunchBlockMessage({
  agentImpl,
  agentLoopVersionId,
  useRepoHead,
}: {
  agentImpl: string;
  agentLoopVersionId: string | null;
  useRepoHead: boolean;
}): Promise<string | null> {
  const targetLoopVersion = agentLoopVersionId
    ? await prisma.agentLoopVersion.findUnique({
        where: { id: agentLoopVersionId },
        select: {
          version: true,
          supportTier: true,
          agentLoop: {
            select: {
              name: true,
            },
          },
        },
      })
    : null;
  const targetLoopSupport = resolveLoopSupport({
    agentImpl,
    loopName: targetLoopVersion?.agentLoop?.name ?? null,
    loopVersion: targetLoopVersion?.version ?? null,
    supportTier: targetLoopVersion?.supportTier ?? null,
    useRepoHead,
    hasLoopVersion: Boolean(agentLoopVersionId),
  });

  return getLoopActionBlockMessage(targetLoopSupport, "relaunch");
}

async function resolveRelaunchAgentLoopVersionId(
  agentImpl: string,
  persistedAgentLoopVersionId: string | null | undefined,
): Promise<string | null> {
  const loop = await prisma.agentLoop.findUnique({
    where: { id: agentImpl },
    select: { currentVersionId: true },
  });

  return loop?.currentVersionId ?? persistedAgentLoopVersionId ?? null;
}

async function buildPlainRelaunchPlan(
  project: LoadedRelaunchProject,
  runtimeConfig: Record<string, unknown> | null,
): Promise<{ success: false; error: string } | RelaunchPlan> {
  const relaunchBlockMessage = await resolveRelaunchBlockMessage({
    agentImpl: project.agentImpl,
    agentLoopVersionId: project.agentLoopVersionId ?? null,
    useRepoHead: runtimeConfigUsesRepoHead(runtimeConfig),
  });
  if (relaunchBlockMessage) {
    return { success: false, error: relaunchBlockMessage };
  }

  const runnerBackend = project.runnerBackend || "local";
  const providerBillingMode = normalizeProviderBillingMode(project.providerBillingMode);
  return {
    agent: project.agent,
    agentImpl: project.agentImpl,
    model: project.model ?? null,
    providerBillingMode,
    needsProvisioning: !project.repoUrl || runnerBackend === "vps",
    projectUpdateData: {
      ...buildRelaunchProjectResetData(),
    },
  };
}

async function buildOverrideRelaunchPlan(
  project: LoadedRelaunchProject,
  primaryComponent: { id?: string | null; sourceConfig?: unknown; runtimeConfig?: unknown } | null,
  overrides: RelaunchOverrides,
): Promise<{ success: false; error: string } | RelaunchPlan> {
  const agent = overrides.agent?.trim() || project.agent;
  const agentImpl = overrides.agentImpl?.trim() || project.agentImpl;
  const model = overrides.model !== undefined ? (overrides.model?.trim() || null) : (project.model ?? null);
  const envOverrides = overrides.envOverrides !== undefined
    ? (overrides.envOverrides ? JSON.stringify(overrides.envOverrides) : null)
    : (project.envOverrides ?? null);
  const claudeAuthMode = overrides.claudeAuthMode !== undefined
    ? (overrides.claudeAuthMode?.trim() || null)
    : (project.claudeAuthMode ?? null);
  const codexAuthMode = overrides.codexAuthMode !== undefined
    ? (overrides.codexAuthMode?.trim() || null)
    : (project.codexAuthMode ?? null);
  let providerBillingMode = normalizeProviderBillingMode(project.providerBillingMode);
  if (overrides.providerBillingMode !== undefined) {
    const rawProviderBillingMode = overrides.providerBillingMode?.trim() || null;
    const parsedProviderBillingMode = parseProviderBillingMode(rawProviderBillingMode);
    if (!parsedProviderBillingMode) {
      return {
        success: false,
        error: rawProviderBillingMode
          ? `Invalid providerBillingMode: ${rawProviderBillingMode}`
          : "providerBillingMode is required",
      };
    }
    providerBillingMode = parsedProviderBillingMode;
  }
  if (claudeAuthMode && !VALID_CLAUDE_AUTH_MODES.includes(claudeAuthMode as any)) {
    return { success: false, error: `Invalid claudeAuthMode: ${claudeAuthMode}` };
  }
  if (codexAuthMode && !VALID_CODEX_AUTH_MODES.includes(codexAuthMode as any)) {
    return { success: false, error: `Invalid codexAuthMode: ${codexAuthMode}` };
  }
  const authModes = normalizeAuthModesForProviderBilling(agent, providerBillingMode, {
    claudeAuthMode,
    codexAuthMode,
  });

  const runnerBackend = overrides.runnerBackend?.trim() || project.runnerBackend || "local";
  const resolvedTooling = await resolveLoopAndTool(agentImpl, agent);
  const toolId = overrides.toolId ?? resolvedTooling?.toolId ?? project.toolId ?? null;
  const agentLoopVersionId = await resolveRelaunchAgentLoopVersionId(
    agentImpl,
    project.agentLoopVersionId ?? null,
  );
  const relaunchBlockMessage = await resolveRelaunchBlockMessage({
    agentImpl,
    agentLoopVersionId,
    useRepoHead: true,
  });
  if (relaunchBlockMessage) {
    return { success: false, error: relaunchBlockMessage };
  }

  const prevSource = getComponentObjectConfig(primaryComponent?.sourceConfig) ?? {};
  const prevRuntime = getComponentObjectConfig(primaryComponent?.runtimeConfig) ?? {};

  return {
    agent,
    agentImpl,
    model,
    providerBillingMode,
    needsProvisioning: !project.repoUrl || runnerBackend === "vps",
    projectUpdateData: {
      ...buildRelaunchProjectResetData(),
      agent,
      agentImpl,
      model,
      envOverrides,
      claudeAuthMode: authModes.claudeAuthMode,
      codexAuthMode: authModes.codexAuthMode,
      providerBillingMode,
      runnerBackend,
      tool: toolId ? { connect: { id: toolId } } : { disconnect: true },
      agentLoopVersion: agentLoopVersionId
        ? { connect: { id: agentLoopVersionId } }
        : { disconnect: true },
    },
    componentConfigUpdate: primaryComponent?.id
      ? {
          componentId: primaryComponent.id,
          data: {
            sourceConfig: {
              ...prevSource,
              agent,
              agentImpl,
              toolId,
              agentLoopVersionId,
            },
            runtimeConfig: {
              ...prevRuntime,
              model,
              envOverrides,
              claudeAuthMode: authModes.claudeAuthMode,
              codexAuthMode: authModes.codexAuthMode,
              providerBillingMode,
              runnerBackend,
              toolId,
              agentLoopVersionId,
              useRepoHead: true,
            },
          },
        }
      : undefined,
  };
}

async function relaunchProjectCore(projectId: string, planBuilder: (
  project: LoadedRelaunchProject,
  primaryComponent: RelaunchComponent | null,
  runtimeConfig: Record<string, unknown> | null,
) => Promise<{ success: false; error: string } | RelaunchPlan>, opts?: { skipUserPolicy?: boolean }) {
  try {
    const project = await loadRelaunchProject(projectId);

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const primaryComponent = getPrimaryLifecycleComponent(project as { components?: Array<Record<string, unknown>> | null });
    const runtimeConfig = getComponentObjectConfig(primaryComponent?.runtimeConfig);

    // Blockers mean the operator row is intentionally waiting. Relaunch is a new
    // lifecycle run, not a maintenance restore or blocker retry.
    const blockedByProjectBlockers = getRelaunchBlockedByProjectBlockersMessage(primaryComponent);
    if (blockedByProjectBlockers) {
      return { success: false, error: blockedByProjectBlockers };
    }

    // RA-192: check component state instead of legacy status
    // Failed-history rows may still keep a live preview, but explicit relaunch must remain available.
    if (isDisplayActive(project) && primaryComponent?.lastOutcome !== "FAILED") {
      return { success: false, error: "Project is already active" };
    }

    // Archived projects must be explicitly unarchived before relaunch.
    if (project.archivedAt) {
      return { success: false, error: "Project is archived. Unarchive it before relaunch." };
    }

    // RA-247: Pre-launch audit gate — block if contract violations exist
    const auditErrors = await preLaunchCheck(projectId);
    if (auditErrors.length > 0) {
      return { success: false, error: `Pre-launch check failed:\n${auditErrors.join("\n")}` };
    }

    const hasSpecContent = project.specs.some((spec: any) => spec.content.trim().length > 0);
    const supportsDirectRuntime = typeof runtimeConfig?.commandTemplate === "string";
    if (!hasSpecContent && !supportsDirectRuntime) {
      return { success: false, error: "Project has no specs" };
    }

    const planResult = await planBuilder(project, primaryComponent, runtimeConfig);
    if ("success" in planResult) {
      return planResult;
    }

    if (!opts?.skipUserPolicy && project.ownerScopeType === "user") {
      const [session, hasBypass] = await Promise.all([auth(), hasE2EAdminBypass()]);
      const platformAccess = await resolvePlatformAccess(session, hasBypass);
      const privileged =
        platformAccess.hasCapability("platform.projects.manage")
        || platformAccess.hasCapability("platform.runtime.manage");
      const plannedRunnerBackend =
        typeof planResult.projectUpdateData.runnerBackend === "string"
        ? planResult.projectUpdateData.runnerBackend
        : project.runnerBackend;
      const policy = await enforceUserLaunchPolicy({
        userId: project.ownerScopeId,
        privileged,
        agent: planResult.agent,
        agentImpl: planResult.agentImpl,
        runnerBackend: plannedRunnerBackend,
        providerBillingMode: planResult.providerBillingMode,
      });
      if (!policy.allowed) {
        return { success: false, error: policy.error };
      }
      if (!privileged) {
        const currentProviderBillingMode = normalizeProviderBillingMode(project.providerBillingMode);
        if (planResult.providerBillingMode !== currentProviderBillingMode) {
          return {
            success: false,
            error: "Provider billing mode cannot be changed on relaunch.",
          };
        }
      }
    }

    if (planResult.providerBillingMode === "platform_credits") {
      const budgetGuard = await enforceRequiredProjectBudget(projectId);
      if (!budgetGuard.allowed) {
        return {
          success: false,
          error: budgetGuard.error ?? formatBudgetBlockedMessage(budgetGuard.remainingUsd),
        };
      }
    }

    if (primaryComponent?.containerName) {
      const removeResult = await removeContainerInternal(projectId, INTERNAL_ACTION_TOKEN);
      if (!removeResult.success) {
        return {
          success: false,
          error: `Failed to tear down stale runtime ${primaryComponent.containerName} before relaunch: ${removeResult.error ?? "unknown worker error"}`,
        };
      }
    }

    await prisma.$transaction(async (tx: TransactionClient) => {
      await tx.project.update({
        where: { id: project.id },
        data: planResult.projectUpdateData,
      });
      const relaunchCtx = { source: "admin" as const, trigger: "relaunch", reason: "user relaunch" };

      // RA-237 ownership: admin writes intent; source:"system" may record confirmed teardown observation.
      // We preserve real blockers (BUDGET/AUTH/SECRETS), but clear stale recoverable INFRA baggage
      // so explicit relaunch/migration can become claimable again.
      //
      // Phase 1 (this transaction): force OFF + normalize to a fresh-start tuple.
      await applyStateChange(tx, project.id, { type: "power", intent: "OFF", force: true }, relaunchCtx);
      await prepareRuntimeForFreshClaim(tx, project.id, {
        source: "system",
        trigger: "relaunch_reset",
        reason: "Explicit relaunch normalizes the project to a fresh-start tuple",
      }, {
        provisionedAt: planResult.needsProvisioning ? null : new Date(),
        clearInfraBlocker: true,
      });

      // RA-247: relaunch always enables agent — via applyStateChange for audit trail
      await applyStateChange(tx, project.id, { type: "agentIntent", intent: "ON" }, relaunchCtx);

      if (planResult.componentConfigUpdate) {
        await tx.projectComponent.update({
          where: { id: planResult.componentConfigUpdate.componentId },
          data: planResult.componentConfigUpdate.data,
        });
      }
    });

    // Phase 2 (separate commit): set ON so worker sees the intermediate OFF first.
    // This is intentionally OUTSIDE the transaction — worker poller will see OFF,
    // stop the container, then see ON and start fresh.
    const relaunchCtx2 = { source: "admin" as const, trigger: "relaunch_phase2", reason: "power on after relaunch" };
    await applyStateChange(prisma, projectId, { type: "power", intent: "ON" }, relaunchCtx2);

    revalidatePath("/admin");

    revalidatePath("/");
    notifyProjectChanged(projectId);
    return { success: true, projectId };
  } catch (error) {
    if (prismaErrorCode(error) === "P2025") {
      return { success: false, error: "Project not found" };
    }
    console.error("Relaunch error:", error);
    return { success: false, error: "Failed to relaunch project" };
  }
}

export async function relaunchProjectInternal(projectId: string, internalActionToken?: unknown) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  return relaunchProjectCore(
    projectId,
    async (project, primaryComponent, runtimeConfig) =>
      buildPlainRelaunchPlan(project, runtimeConfig),
    { skipUserPolicy: true },
  );
}

export async function relaunchProjectWithOverridesInternal(
  projectId: string,
  overrides: RelaunchOverrides,
  internalActionToken?: unknown,
) {
  const internalGuard = requireInternalActionToken(internalActionToken);
  if (internalGuard) return internalGuard;

  return relaunchProjectCore(
    projectId,
    async (project, primaryComponent) =>
      buildOverrideRelaunchPlan(project, primaryComponent, overrides),
    { skipUserPolicy: true },
  );
}

export async function relaunchProject(projectId: string) {
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) return { success: false, error: access.error };

  return relaunchProjectCore(
    projectId,
    async (project, _primaryComponent, runtimeConfig) =>
      buildPlainRelaunchPlan(project, runtimeConfig),
  );
}

export async function relaunchProjectWithOverrides(projectId: string, overrides: RelaunchOverrides) {
  const access = await requireProjectCapability(projectId, "project.runtime.manage");
  if (!access.authorized) return { success: false, error: access.error };

  return relaunchProjectCore(
    projectId,
    async (project, primaryComponent) =>
      buildOverrideRelaunchPlan(project, primaryComponent, overrides),
  );
}
