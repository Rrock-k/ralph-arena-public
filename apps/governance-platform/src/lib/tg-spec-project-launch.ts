import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { reserveUserCreditsForProjectBudget } from "@/app/actions/credits";
import { notifyProjectChanged, notifyProjectEvent } from "@/lib/progress-bus";
import {
  PROJECT_ADDONS,
  getProjectAddon,
  normalizeProjectAddonIds,
  type ProjectAddonDefinition,
} from "@/lib/project-addons";
import { buildProjectAddonSpecVersionCreate } from "@/lib/project-addon-artifacts";
import { mergeRequiredSecrets, parseRequiredSecrets } from "@/lib/required-secrets";
import {
  enforceUserLaunchPolicy,
  normalizeAuthModesForProviderBilling,
  parseProviderBillingMode,
} from "@/lib/user-launch-policy";
import {
  enforceRequiredProjectBudget,
  formatBudgetBlockedMessage,
} from "@/lib/project-budget";
import {
  applyStateChange,
  prepareRuntimeForFreshClaim,
} from "@/lib/project-state-effects";
import {
  TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED,
  clearTgSpecLaunchConfigurationState,
  getTgSpecLaunchConfigurationState,
  isTgSpecTargetSourceConfig,
  setTgSpecLaunchConfigurationState,
} from "@/lib/tg-spec-target";
import { getLoopActionBlockMessage, getProjectLoopSupport } from "@/lib/loop-support";
import { resolveLaunchCatalogSelection, trimToNull } from "@/lib/model-catalog";
import { preLaunchCheck } from "@/lib/project-audit";
import {
  buildVisualWorkbenchEvidenceAutomationRuntimeConfig,
  isVisualEvidenceMode,
  type VisualEvidenceMode,
} from "@/lib/visual-workbench-runtime-config";

const DEFAULT_WORKER_IMAGE = process.env.WORKER_IMAGE || "arena-public-worker:local";
const VALID_CLAUDE_AUTH_MODES = ["oauth", "api_key"] as const;
const VALID_CODEX_AUTH_MODES = ["subscription", "api_key"] as const;

type TransactionClient = Prisma.TransactionClient;

export type TgSpecProjectLaunchActor = {
  actorUserId?: string | null;
  privileged: boolean;
};

export type ConfigureTgSpecProjectLaunchInput = {
  agent: string;
  agentImpl: string;
  model?: string | null;
  envOverrides?: Record<string, string | null> | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
  runnerBackend: "local" | "vps";
  toolId?: string | null;
  providerBillingMode: string;
  initialBudgetUsd?: number | null;
  addonIds?: string[] | null;
  visualEvidenceMode?: VisualEvidenceMode;
  visualWorkbenchEvidenceAutomation?: boolean;
};

type ActionResult =
  | { success: true; projectId: string }
  | { success: false; error: string };

function normalizeOptionalBudget(value: number | null | undefined): (
  { success: true; value: number | null }
  | { success: false; error: string }
) {
  if (value == null) {
    return { success: true, value: null };
  }
  const initialBudgetUsd = Number(value);
  if (!Number.isFinite(initialBudgetUsd) || initialBudgetUsd < 0.11) {
    return { success: false, error: "Budget limit must be at least $0.11" };
  }
  return { success: true, value: Math.round(initialBudgetUsd * 100) / 100 };
}

function getObjectConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function currentVisualEvidenceMode(runtimeConfig: Record<string, unknown>): VisualEvidenceMode {
  const rawMode = runtimeConfig.visualEvidenceMode;
  if (isVisualEvidenceMode(rawMode)) return rawMode;
  if (rawMode !== undefined) {
    throw new Error("Invalid visualEvidenceMode runtimeConfig: expected off, required or new_tasks_only.");
  }
  return runtimeConfig.visualWorkbenchEvidenceAutomation == null ? "off" : "required";
}

function resolveVisualEvidenceMode(
  input: Pick<ConfigureTgSpecProjectLaunchInput, "visualEvidenceMode" | "visualWorkbenchEvidenceAutomation">,
  runtimeConfig: Record<string, unknown>,
): VisualEvidenceMode {
  if (input.visualEvidenceMode !== undefined) return input.visualEvidenceMode;
  if (input.visualWorkbenchEvidenceAutomation === true) return "required";
  if (input.visualWorkbenchEvidenceAutomation === false) return "off";
  return currentVisualEvidenceMode(runtimeConfig);
}

function serializeRequiredSecrets(entries: ReturnType<typeof parseRequiredSecrets>): string | null {
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

function resolveLaunchAddons(addonIds: string[] | null | undefined): (
  { success: true; addons: ProjectAddonDefinition[]; addonIds: string[] }
  | { success: false; error: string }
) {
  const normalized = normalizeProjectAddonIds(addonIds);
  const addons: ProjectAddonDefinition[] = [];

  for (const addonId of normalized) {
    const addon = getProjectAddon(addonId);
    if (!addon) {
      return { success: false, error: `Unknown project add-on: ${addonId}` };
    }
    addons.push(addon);
  }

  return { success: true, addons, addonIds: normalized };
}

function configuredAddonIdsFromConfig(config: unknown): string[] {
  const object = getObjectConfig(config);
  return Array.isArray(object.addonIds)
    ? object.addonIds.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function currentProjectAddonIds(project: NonNullable<Awaited<ReturnType<typeof loadProject>>>, component: { sourceConfig: unknown; runtimeConfig: unknown }) {
  const configured = new Set<string>([
    ...configuredAddonIdsFromConfig(component.sourceConfig),
    ...configuredAddonIdsFromConfig(component.runtimeConfig),
  ]);
  const addonSpecTitles = new Set<string>(
    (project.specs ?? [])
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

function nextRequiredSecretsForAddons(
  existingRaw: string | null | undefined,
  selectedAddons: ProjectAddonDefinition[],
) {
  const knownAddonSecretKeys = new Set(
    PROJECT_ADDONS.flatMap((addon) => addon.requiredSecrets.map((secret) => secret.key)),
  );
  const selectedAddonSecretKeys = new Set(
    selectedAddons.flatMap((addon) => addon.requiredSecrets.map((secret) => secret.key)),
  );
  const existingWithoutDeselectedAddons = parseRequiredSecrets(existingRaw)
    .filter((secret) => !knownAddonSecretKeys.has(secret.key) || selectedAddonSecretKeys.has(secret.key));
  return mergeRequiredSecrets(
    existingWithoutDeselectedAddons,
    selectedAddons.flatMap((addon) => addon.requiredSecrets),
  ).list;
}

function nextSecretBlockers(
  currentBlockers: string[],
  requiredSecrets: ReturnType<typeof parseRequiredSecrets>,
  providedSecretKeys: Set<string>,
): string[] {
  const hasMissingBlockingSecret = requiredSecrets.some((secret) => (
    secret.blocking !== false && !providedSecretKeys.has(secret.key)
  ));
  const withoutSecretBlocker = currentBlockers.filter((blocker) => blocker !== "SECRETS");
  return hasMissingBlockingSecret ? [...withoutSecretBlocker, "SECRETS"] : withoutSecretBlocker;
}

function revalidateProjectSurfaces(projectId: string): void {
  revalidatePath("/my");
  revalidatePath("/admin");
  revalidatePath(`/my/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
}

async function loadProject(projectId: string) {
  return (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      archivedAt: true,
      ownerScopeType: true,
      ownerScopeId: true,
      agent: true,
      agentImpl: true,
      model: true,
      providerBillingMode: true,
      requiredSecrets: true,
      runnerBackend: true,
      tgSpecLastImportedVersion: true,
      repoUrl: true,
      repoBranch: true,
      secrets: { select: { key: true } },
      specs: {
        select: {
          title: true,
          versions: { select: { externalSourceSystem: true } },
        },
      },
      components: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          id: true,
          sourceConfig: true,
          runtimeConfig: true,
          powerIntent: true,
          agentIntent: true,
          runtimeState: true,
          agentState: true,
          blockers: true,
        },
      },
    },
  });
}

function validateTgSpecSetupTarget(project: Awaited<ReturnType<typeof loadProject>>) {
  if (!project) {
    return { success: false as const, error: "Project not found" };
  }
  if (project.archivedAt) {
    return { success: false as const, error: "Project is archived" };
  }
  const component = project.components?.[0] ?? null;
  if (!component || !isTgSpecTargetSourceConfig(component.sourceConfig)) {
    return { success: false as const, error: "Project is not configured as a tg-spec target" };
  }
  const launchState = getTgSpecLaunchConfigurationState(component.sourceConfig);
  if (!launchState) {
    return { success: false as const, error: "Project launch is already active" };
  }
  const prematureLaunchRuntimeDrift = launchState === TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED
    && component.runtimeState === "RUNNING"
    && component.agentState !== "RUNNING"
    && component.blockers.includes("INFRA");
  if ((component.runtimeState === "RUNNING" || component.agentState === "RUNNING") && !prematureLaunchRuntimeDrift) {
    return { success: false as const, error: "Project runtime is already active" };
  }
  return { success: true as const, component, launchState };
}

function validateLaunchBillingActor(
  project: NonNullable<Awaited<ReturnType<typeof loadProject>>>,
  actor: TgSpecProjectLaunchActor,
) {
  if (actor.privileged) return { success: true as const };
  if (
    actor.actorUserId
    && project.ownerScopeType === "user"
    && project.ownerScopeId === actor.actorUserId
  ) {
    return { success: true as const };
  }
  return {
    success: false as const,
    error: "Only the project owner can configure or start billing-backed tg-spec launches.",
  };
}

async function upsertExplicitBudgetLimit(
  tx: TransactionClient,
  projectId: string,
  actorUserId: string | null | undefined,
  amountUsd: number,
) {
  await (tx as any).projectBudget.upsert({
    where: { projectId },
    create: {
      projectId,
      isEnabled: true,
      totalCreditsUsd: amountUsd,
      usedCreditsUsd: 0,
      note: "Initial tg-spec launch budget",
    },
    update: {
      isEnabled: true,
      totalCreditsUsd: amountUsd,
      note: "Initial tg-spec launch budget",
    },
  });

  if (actorUserId) {
    await (tx as any).projectBudgetAdjustment.create({
      data: {
        projectId,
        createdById: actorUserId,
        amountUsd,
        kind: "SET_LIMIT",
        note: "Initial tg-spec launch budget",
      },
    });
  }
}

async function reservePlatformCreditsBudgetDelta(
  tx: TransactionClient,
  input: {
    projectId: string;
    ownerUserId: string;
    targetBudgetUsd: number;
  },
) {
  const existingBudget = await (tx as any).projectBudget.findUnique({
    where: { projectId: input.projectId },
    select: { totalCreditsUsd: true, usedCreditsUsd: true, isEnabled: true },
  });
  const currentBudgetUsd = existingBudget?.isEnabled ? Number(existingBudget.totalCreditsUsd) : 0;
  const deltaUsd = Math.round(Math.max(0, input.targetBudgetUsd - currentBudgetUsd) * 100) / 100;

  if (deltaUsd > 0) {
    await reserveUserCreditsForProjectBudget(tx, {
      userId: input.ownerUserId,
      projectId: input.projectId,
      amountUsd: deltaUsd,
      note: "Initial tg-spec Platform Credits budget",
    });
    return;
  }

  if (existingBudget && !existingBudget.isEnabled) {
    await (tx as any).projectBudget.update({
      where: { projectId: input.projectId },
      data: { isEnabled: true },
    });
  }
}

export async function configureTgSpecProjectLaunch(
  projectId: string,
  input: ConfigureTgSpecProjectLaunchInput,
  actor: TgSpecProjectLaunchActor,
): Promise<ActionResult> {
  const project = await loadProject(projectId);
  const target = validateTgSpecSetupTarget(project);
  if (!target.success) return target;
  const actorCheck = validateLaunchBillingActor(project, actor);
  if (!actorCheck.success) return actorCheck;

  const agent = input.agent.trim();
  const agentImpl = input.agentImpl.trim();
  if (!agent || !agentImpl) {
    return { success: false, error: "Agent tool and loop are required" };
  }

  const providerBillingMode = parseProviderBillingMode(input.providerBillingMode);
  if (!providerBillingMode) {
    return { success: false, error: `Invalid providerBillingMode: ${input.providerBillingMode}` };
  }

  const budgetLimit = normalizeOptionalBudget(input.initialBudgetUsd);
  if (!budgetLimit.success) return budgetLimit;
  if (providerBillingMode === "platform_credits" && budgetLimit.value == null) {
    return { success: false, error: "Platform Credits launches require an initial budget." };
  }

  const claudeAuthMode = trimToNull(input.claudeAuthMode);
  const codexAuthMode = trimToNull(input.codexAuthMode);
  if (claudeAuthMode && !VALID_CLAUDE_AUTH_MODES.includes(claudeAuthMode as any)) {
    return { success: false, error: `Invalid claudeAuthMode: ${claudeAuthMode}` };
  }
  if (codexAuthMode && !VALID_CODEX_AUTH_MODES.includes(codexAuthMode as any)) {
    return { success: false, error: `Invalid codexAuthMode: ${codexAuthMode}` };
  }

  const runnerBackend = input.runnerBackend;
  const launchSelection = await resolveLaunchCatalogSelection({
    agent,
    agentImpl,
    toolId: input.toolId,
    model: input.model,
    envOverrides: input.envOverrides,
  });
  if (!launchSelection.success) return launchSelection;
  const { toolId, agentLoopVersionId } = launchSelection;

  const policy = await enforceUserLaunchPolicy({
    userId: project.ownerScopeId,
    privileged: actor.privileged,
    agent,
    agentImpl,
    runnerBackend,
    providerBillingMode,
  });
  if (!policy.allowed) {
    return { success: false, error: policy.error };
  }

  const authModes = normalizeAuthModesForProviderBilling(agent, providerBillingMode, {
    claudeAuthMode,
    codexAuthMode,
  });
  const selectedAddonIds = input.addonIds === undefined
    ? currentProjectAddonIds(project, target.component)
    : input.addonIds;
  const addonResult = resolveLaunchAddons(selectedAddonIds);
  if (!addonResult.success) return addonResult;
  const addonIds = addonResult.addonIds;
  const requiredSecrets = nextRequiredSecretsForAddons(project.requiredSecrets, addonResult.addons);
  const providedSecretKeys = new Set<string>((project.secrets ?? []).map((secret: { key: string }) => secret.key));
  const blockers = nextSecretBlockers(target.component.blockers ?? [], requiredSecrets, providedSecretKeys);
  const envOverrides = launchSelection.envOverrides ? JSON.stringify(launchSelection.envOverrides) : null;
  const model = launchSelection.model;
  const sourceConfig = getObjectConfig(target.component.sourceConfig);
  const runtimeConfig = getObjectConfig(target.component.runtimeConfig);
  const visualEvidenceMode = resolveVisualEvidenceMode(input, runtimeConfig);
  const nextRuntimeConfig: Record<string, unknown> = {
    ...runtimeConfig,
    visualEvidenceMode,
    model,
    envOverrides,
    claudeAuthMode: authModes.claudeAuthMode,
    codexAuthMode: authModes.codexAuthMode,
    providerBillingMode,
    runnerBackend,
    cycleImage: typeof runtimeConfig.cycleImage === "string"
      ? runtimeConfig.cycleImage
      : DEFAULT_WORKER_IMAGE,
    toolId,
    agentLoopVersionId,
    addonIds,
    useRepoHead: true,
  };
  if (visualEvidenceMode === "off") {
    delete nextRuntimeConfig.visualWorkbenchEvidenceAutomation;
  } else {
    nextRuntimeConfig.visualWorkbenchEvidenceAutomation = buildVisualWorkbenchEvidenceAutomationRuntimeConfig();
  }

  try {
    await prisma.$transaction(async (tx: TransactionClient) => {
      await (tx as any).project.update({
        where: { id: projectId },
        data: {
          agent,
          agentImpl,
          model,
          envOverrides,
          claudeAuthMode: authModes.claudeAuthMode,
          codexAuthMode: authModes.codexAuthMode,
          providerBillingMode,
          requiredSecrets: serializeRequiredSecrets(requiredSecrets),
          runnerBackend,
          tool: { connect: { id: toolId } },
          agentLoopVersion: { connect: { id: agentLoopVersionId } },
        },
      });

      const existingAddonSpecs = await (tx as any).spec.findMany({
        where: {
          projectId,
          title: { in: PROJECT_ADDONS.map((addon) => addon.specTitle) },
        },
        select: {
          id: true,
          title: true,
          versions: { select: { externalSourceSystem: true } },
        },
      });
      const selectedAddonTitles = new Set(addonResult.addons.map((addon) => addon.specTitle));
      const existingAddonTitles = new Set(existingAddonSpecs.map((spec: { title: string | null }) => spec.title).filter(Boolean));
      const removedAddonSpecIds = existingAddonSpecs
        .filter((spec: { id: string; title: string | null; versions: { externalSourceSystem: string | null }[] }) => (
          spec.title && !selectedAddonTitles.has(spec.title) && spec.versions.some((version) => version.externalSourceSystem === "arena")
        ))
        .map((spec: { id: string }) => spec.id);
      for (const specId of removedAddonSpecIds) {
        await (tx as any).spec.delete({ where: { id: specId } });
      }

      const maxSpecOrder = await (tx as any).spec.aggregate({
        where: { projectId },
        _max: { orderIndex: true },
      });
      let nextSpecOrder = Number(maxSpecOrder?._max?.orderIndex ?? -1) + 1;
      for (const addon of addonResult.addons) {
        if (existingAddonTitles.has(addon.specTitle)) continue;
        await (tx as any).spec.create({
          data: {
            projectId,
            title: addon.specTitle,
            content: addon.specContent,
            orderIndex: nextSpecOrder,
            versions: {
              create: buildProjectAddonSpecVersionCreate(addon),
            },
          },
        });
        nextSpecOrder += 1;
      }

      await (tx as any).projectComponent.update({
        where: { id: target.component.id },
        data: {
          blockers,
          sourceConfig: {
            ...setTgSpecLaunchConfigurationState(sourceConfig, TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED),
            repoUrl: project.repoUrl,
            repoBranch: project.repoBranch,
            agent,
            agentImpl,
            toolId,
            agentLoopVersionId,
            addonIds,
          },
          runtimeConfig: {
            ...nextRuntimeConfig,
          },
        },
      });

      if (providerBillingMode === "platform_credits") {
        if (project.ownerScopeType !== "user" || !project.ownerScopeId) {
          throw new Error("A project owner is required for Platform Credits launches.");
        }
        await reservePlatformCreditsBudgetDelta(tx, {
          projectId,
          ownerUserId: project.ownerScopeId,
          targetBudgetUsd: budgetLimit.value!,
        });
      } else if (budgetLimit.value != null) {
        await upsertExplicitBudgetLimit(tx, projectId, actor.actorUserId, budgetLimit.value);
      }

      await (tx as any).runLog.create({
        data: {
          projectId,
          event: "LAUNCH_CONFIGURED",
          detail: JSON.stringify({
            agent,
            agentImpl,
            model,
            providerBillingMode,
            runnerBackend,
            toolId,
            agentLoopVersionId,
            addonIds,
            budgetLimitUsd: budgetLimit.value,
            ...(input.visualEvidenceMode !== undefined || input.visualWorkbenchEvidenceAutomation !== undefined
              ? { visualEvidenceMode }
              : {}),
          }),
        },
      });
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to configure launch",
    };
  }

  revalidateProjectSurfaces(projectId);
  notifyProjectChanged(projectId);
  return { success: true, projectId };
}

export async function startTgSpecProjectLaunch(
  projectId: string,
  actor: TgSpecProjectLaunchActor,
): Promise<ActionResult> {
  const project = await loadProject(projectId);
  const target = validateTgSpecSetupTarget(project);
  if (!target.success) return target;
  const actorCheck = validateLaunchBillingActor(project, actor);
  if (!actorCheck.success) return actorCheck;
  if (target.launchState !== TG_SPEC_LAUNCH_CONFIGURATION_CONFIGURED) {
    return { success: false, error: "Launch configuration is required before start." };
  }
  if (project.tgSpecLastImportedVersion == null) {
    return { success: false, error: "First accepted tg-spec import is required before start." };
  }

  const policy = await enforceUserLaunchPolicy({
    userId: project.ownerScopeId,
    privileged: actor.privileged,
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
      return {
        success: false,
        error: budgetGuard.error ?? formatBudgetBlockedMessage(budgetGuard.remainingUsd),
      };
    }
  }

  const loopSupport = await getProjectLoopSupport(prisma as any, projectId);
  const blockMessage = loopSupport ? getLoopActionBlockMessage(loopSupport, "launch") : null;
  if (blockMessage) {
    return { success: false, error: blockMessage };
  }

  const auditErrors = await preLaunchCheck(projectId);
  if (auditErrors.length > 0) {
    return { success: false, error: `Pre-launch check failed:\n${auditErrors.join("\n")}` };
  }

  const sourceConfig = clearTgSpecLaunchConfigurationState(target.component.sourceConfig);
  await prisma.$transaction(async (tx: TransactionClient) => {
    await (tx as any).projectComponent.update({
      where: { id: target.component.id },
      data: { sourceConfig },
    });

    await prepareRuntimeForFreshClaim(tx, projectId, {
      source: "system",
      trigger: "tg_spec_launch_start_reset",
      reason: "Explicit tg-spec Project API start prepares the first runtime claim",
    }, {
      provisionedAt: project.repoUrl && project.runnerBackend !== "vps" ? new Date() : null,
      clearInfraBlocker: true,
    });

    await applyStateChange(tx, projectId, { type: "agentIntent", intent: "ON" }, {
      source: "admin",
      trigger: "tg_spec_launch_start_agent_on",
      reason: "Explicit tg-spec Project API start",
    });
    await applyStateChange(tx, projectId, { type: "power", intent: "ON" }, {
      source: "admin",
      trigger: "tg_spec_launch_start_power_on",
      reason: "Explicit tg-spec Project API start",
    });
    await (tx as any).runLog.create({
      data: {
        projectId,
        event: "LAUNCHED",
        detail: JSON.stringify({
          source: "tg_spec_project_api",
          agent: project.agent,
          agentImpl: project.agentImpl,
          providerBillingMode: project.providerBillingMode,
          tgSpecLastImportedVersion: project.tgSpecLastImportedVersion,
        }),
      },
    });
  });

  revalidateProjectSurfaces(projectId);
  notifyProjectChanged(projectId);
  notifyProjectEvent(projectId, {
    type: "project_event",
    status: "LAUNCHED",
  });
  return { success: true, projectId };
}
