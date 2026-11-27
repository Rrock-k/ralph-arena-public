"use server";

import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { getProjectRecipe, type ProjectRecipeId } from "@/lib/project-recipes";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { progressBus } from "@/lib/progress-bus";
import {
  isValidRequiredSecretKey,
  mergeRequiredSecrets,
  normalizeRequiredSecretKey,
  type RequiredSecretEntry,
} from "@/lib/required-secrets";
import { resolveLoopAndTool } from "@/lib/control-plane";
import { buildWorkspaceLabel } from "@/lib/workspace-label";
import { TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED, TG_SPEC_TARGET_RECIPE } from "@/lib/tg-spec-target";
import { resolvePlatformAccess } from "@/lib/platform-access";
import {
  enforceUserLaunchPolicy,
  normalizeAuthModesForProviderBilling,
  parseProviderBillingMode,
} from "@/lib/user-launch-policy";
import { isByokProviderKeysEnabled } from "@/lib/feature-flags";
import { reserveUserCreditsForProjectBudget } from "@/app/actions/credits";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";
import {
  getProjectAddon,
  normalizeProjectAddonIds,
  type ProjectAddonDefinition,
} from "@/lib/project-addons";
import { buildProjectAddonSpecVersionCreate } from "@/lib/project-addon-artifacts";
import { encryptSecret, getEncryptionKey } from "@/lib/crypto";
import { parseSourceSeedProfile, type SourceSeedProfile } from "@/lib/source-seed-profile";

const VALID_CLAUDE_AUTH_MODES = ["oauth", "api_key"] as const;
const VALID_CODEX_AUTH_MODES = ["subscription", "api_key"] as const;
const DEFAULT_WORKER_IMAGE = process.env.WORKER_IMAGE || "arena-public-worker:local";
const BYOK_RECIPE_IDS = new Set<ProjectRecipeId>(["openclaw"]);

type TransactionClient = Prisma.TransactionClient;

type CreatePersonalAgentProjectInput = {
  name: string;
  spec: string;
  initialBudgetUsd?: number | null;
  agent: string;
  agentImpl: string;
  model?: string | null;
  envOverrides?: Record<string, string | null> | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
  runnerBackend?: string | null;
  toolId?: string | null;
  proposalId?: string | null;
  repoUrl?: string | null;
  repoBranch?: string | null;
  vpsServerType?: string | null;
  providerBillingMode?: string | null;
  addonIds?: string[] | null;
  addonSecretValues?: Record<string, string | null> | null;
  sourceSeedProfile?: string | null;
};

type CreatePersonalTgSpecProjectInput = {
  name: string;
  initialBudgetUsd?: number | null;
  agent: string;
  agentImpl: string;
  model?: string | null;
  envOverrides?: Record<string, string | null> | null;
  claudeAuthMode?: string | null;
  codexAuthMode?: string | null;
  runnerBackend?: string | null;
  toolId?: string | null;
  proposalId?: string | null;
  repoUrl?: string | null;
  repoBranch?: string | null;
  vpsServerType?: string | null;
  providerBillingMode?: string | null;
  addonIds?: string[] | null;
  addonSecretValues?: Record<string, string | null> | null;
  sourceSeedProfile?: string | null;
};

type CreatePersonalRecipeProjectInput = {
  recipeId: ProjectRecipeId;
  name: string;
  initialBudgetUsd?: number | null;
  runnerBackend?: string | null;
};

type ResolvedPersonalAgentProjectCreate = {
  name: string;
  budgetLimitUsd: number | null;
  agent: string;
  agentImpl: string;
  model: string | null;
  envOverrides: string | null;
  claudeAuthMode: string | null;
  codexAuthMode: string | null;
  runnerBackend: string;
  toolId: string;
  agentLoopVersionId: string;
  proposalId: string | null;
  repoUrl: string | null;
  repoBranch: string;
  vpsServerType: string | null;
  providerBillingMode: string;
  sourceSeedProfile: SourceSeedProfile | null;
  addons: ProjectAddonDefinition[];
  addonRequiredSecrets: RequiredSecretEntry[];
  addonSecretValues: Record<string, string>;
};

type ResolvePersonalAgentProjectCreateOptions = {
  allowMissingAddonSecrets?: boolean;
};

function normalizeOptionalBudget(value: number | null | undefined): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null) {
    return { ok: true, value: null };
  }
  const initialBudgetUsd = Number(value);
  if (!Number.isFinite(initialBudgetUsd) || initialBudgetUsd < 0.11) {
    return { ok: false, error: "Budget limit must be at least $0.11" };
  }
  return { ok: true, value: initialBudgetUsd };
}

function serializeRequiredSecrets(entries: RequiredSecretEntry[]): string | null {
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

function buildInitialSpecCreate(spec: string, addons: ProjectAddonDefinition[]) {
  const initialSpec = {
    title: "Initial Spec",
    content: spec,
    orderIndex: 0,
    versions: {
      create: {
        version: 1,
        content: spec,
        message: "Initial version",
      },
    },
  };

  if (addons.length === 0) {
    return initialSpec;
  }

  return [
    initialSpec,
    ...addons.map((addon, index) => ({
      title: addon.specTitle,
      content: addon.specContent,
      orderIndex: index + 1,
      versions: {
        create: buildProjectAddonSpecVersionCreate(addon),
      },
    })),
  ];
}

function resolveProjectAddons(addonIds: string[] | null | undefined): (
  { success: true; addons: ProjectAddonDefinition[] }
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

  return { success: true, addons };
}

function collectAddonRequiredSecrets(addons: ProjectAddonDefinition[]): RequiredSecretEntry[] {
  return mergeRequiredSecrets([], addons.flatMap((addon) => addon.requiredSecrets)).list;
}

function resolveAddonSecretValues(
  requiredSecrets: RequiredSecretEntry[],
  rawValues: Record<string, string | null> | null | undefined,
  options: { allowMissingBlockingSecrets?: boolean } = {},
): { success: true; values: Record<string, string> } | { success: false; error: string } {
  const values: Record<string, string> = {};

  for (const secret of requiredSecrets) {
    const key = normalizeRequiredSecretKey(secret.key);
    if (!key || !isValidRequiredSecretKey(key)) {
      return { success: false, error: `Invalid add-on required secret key: ${secret.key}` };
    }
    const rawValue = rawValues?.[key] ?? rawValues?.[secret.key] ?? "";
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!value) {
      if (secret.blocking !== false && options.allowMissingBlockingSecrets !== true) {
        return { success: false, error: `Missing required add-on secret: ${key}` };
      }
      continue;
    }
    values[key] = value;
  }

  return { success: true, values };
}

async function createInitialProjectSecrets(
  tx: TransactionClient,
  projectId: string,
  requiredSecrets: RequiredSecretEntry[],
  values: Record<string, string>,
) {
  const entries = requiredSecrets.filter((secret) => values[secret.key]);
  if (entries.length === 0) return;

  const encKey = getEncryptionKey();
  for (const secret of entries) {
    const encrypted = encryptSecret(values[secret.key], encKey);
    await tx.projectSecret!.create({
      data: {
        projectId,
        key: secret.key,
        encryptedValue: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        description: secret.description?.trim() || null,
      },
    });
  }
}

async function requireSignedInUser() {
  const session = await auth();
  const hasBypass = await hasE2EAdminBypass();
  if (hasBypass) {
    return {
      success: true as const,
      hasBypass: true,
      session: {
        user: {
          id: session?.user?.id ?? "e2e-admin-bypass",
          role: session?.user?.role ?? "ADMIN",
        },
      },
    };
  }
  if (!session?.user?.id) {
    return { success: false as const, error: "You must be signed in to create a project" };
  }
  return { success: true as const, hasBypass: false, session };
}

function finishCreate(projectId: string) {
  revalidatePath("/my");
  revalidatePath("/admin");

  progressBus.notifyChanged();
  return { success: true as const, projectId };
}

function normalizeUserLaunchInput<T extends CreatePersonalTgSpecProjectInput>(
  input: T,
  resolvedCreate: ResolvedPersonalAgentProjectCreate,
  privileged: boolean,
): T {
  if (privileged) return input;

  return {
    ...input,
    runnerBackend: "local",
    providerBillingMode: resolvedCreate.providerBillingMode,
  };
}

export async function createPersonalAgentProjectInternal(
  input: CreatePersonalAgentProjectInput,
  opts?: { ownerScopeId?: string | null; internalActionToken?: unknown },
) {
  const internalGuard = requireInternalActionToken(opts?.internalActionToken);
  if (internalGuard) return internalGuard;

  const spec = input.spec.trim();
  if (!spec) {
    return { success: false as const, error: "Initial spec is required" };
  }

  const resolvedCreate = await resolvePersonalAgentProjectCreate(input);
  if (!resolvedCreate.success) {
    return resolvedCreate;
  }

  const {
    name,
    budgetLimitUsd,
    agent,
    agentImpl,
    model,
    claudeAuthMode,
    codexAuthMode,
    runnerBackend,
    envOverrides,
    repoUrl,
    repoBranch,
    vpsServerType,
    providerBillingMode,
    sourceSeedProfile,
    proposalId,
    toolId,
    agentLoopVersionId,
    addons,
    addonRequiredSecrets,
    addonSecretValues,
  } = resolvedCreate;

  try {
    const ownerScopeId = opts?.ownerScopeId?.trim() || "arena-admin-api";

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          mode: "personal",
          ownerScopeType: "user",
          ownerScopeId,
          archivedAt: null,
          agent,
          agentImpl,
          model,
          envOverrides,
          claudeAuthMode,
          codexAuthMode,
          runnerBackend,
          toolId,
          agentLoopVersionId,
          proposalId,
          repoUrl,
          repoBranch,
          vpsServerType,
          providerBillingMode,
          visibility: "private",
          requiredSecrets: serializeRequiredSecrets(addonRequiredSecrets),
          specSnapshot: spec,
          ...(budgetLimitUsd != null && providerBillingMode !== "platform_credits"
            ? {
                budget: {
                  create: {
                    isEnabled: true,
                    totalCreditsUsd: budgetLimitUsd,
                    usedCreditsUsd: 0,
                  },
                },
              }
            : {}),
          specs: {
            create: buildInitialSpecCreate(spec, addons),
          },
          components: {
            create: {
              name: "main",
              kind: "app",
              powerIntent: "ON",
              runtimeState: "ABSENT",
              agentState: "IDLE",
              sourceType: repoUrl ? "git" : "managed",
              sourceConfig: {
                recipe: "agent_project",
                repoUrl,
                repoBranch,
                agent,
                agentImpl,
                toolId,
                agentLoopVersionId,
                ...(sourceSeedProfile ? { sourceSeedProfile } : {}),
                ...(addons.length > 0 ? { addonIds: addons.map((addon) => addon.id) } : {}),
              },
              runtimeConfig: {
                model,
                cycleImage: DEFAULT_WORKER_IMAGE,
                runnerBackend,
                toolId,
                agentLoopVersionId,
                vpsServerType,
                ...(addons.length > 0 ? { addonIds: addons.map((addon) => addon.id) } : {}),
                ...(agentImpl === "dummy" ? { repoProvisioning: "skip" } : {}),
                useRepoHead: true,
              },
            },
          },
        },
        select: { id: true },
      });

      await createInitialProjectSecrets(tx, created.id, addonRequiredSecrets, addonSecretValues);

      // RA-216: Set immutable slug for runtime identity
      await tx.project.update({
        where: { id: created.id },
        data: { slug: buildWorkspaceLabel(name, created.id) },
      });

      if (budgetLimitUsd != null && providerBillingMode === "platform_credits") {
        await reserveUserCreditsForProjectBudget(tx, {
          userId: ownerScopeId,
          projectId: created.id,
          amountUsd: budgetLimitUsd,
          note: "Initial Platform Credits budget",
        });
      }

      await tx.runLog.create({
        data: {
          projectId: created.id,
          event: "LAUNCHED",
          detail: JSON.stringify({
            agent,
            agentImpl,
            model,
            personal: true,
            recipe: "agent_project",
            ...(addons.length > 0 ? { addons: addons.map((addon) => addon.id) } : {}),
            ...(repoUrl ? { repoUrl, repoBranch } : {}),
          }),
        },
      });

      return created.id;
    });

    return finishCreate(project);
  } catch (error) {
    console.error("Create personal project error:", error);
    return { success: false as const, error: "Failed to create project" };
  }
}

export async function createPersonalAgentProject(input: CreatePersonalAgentProjectInput) {
  const authResult = await requireSignedInUser();
  if (!authResult.success) {
    return authResult;
  }
  const platformAccess = await resolvePlatformAccess(authResult.session as any, authResult.hasBypass);
  const resolvedCreate = await resolvePersonalAgentProjectCreate(input);
  if (!resolvedCreate.success) {
    return resolvedCreate;
  }
  const privileged = platformAccess.hasCapability("platform.projects.manage");
  if (resolvedCreate.providerBillingMode === "platform_credits" && resolvedCreate.budgetLimitUsd == null) {
    return { success: false as const, error: "Platform Credits launches require an initial budget." };
  }
  const policy = await enforceUserLaunchPolicy({
    userId: authResult.session.user.id,
    privileged,
    agent: resolvedCreate.agent,
    agentImpl: resolvedCreate.agentImpl,
    runnerBackend: resolvedCreate.runnerBackend,
    providerBillingMode: resolvedCreate.providerBillingMode,
  });
  if (!policy.allowed) {
    return { success: false as const, error: policy.error };
  }

  return createPersonalAgentProjectInternal(normalizeUserLaunchInput(input, resolvedCreate, privileged), {
    ownerScopeId: authResult.session.user.id,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
}

export async function createPersonalTgSpecProjectInternal(
  input: CreatePersonalTgSpecProjectInput,
  opts?: {
    ownerScopeId?: string | null;
    tgSpecSourceProjectId?: string | null;
    awaitingLaunchConfiguration?: boolean;
    allowMissingAddonSecrets?: boolean;
    internalActionToken?: unknown;
  },
) {
  const internalGuard = requireInternalActionToken(opts?.internalActionToken);
  if (internalGuard) return internalGuard;

  const resolvedCreate = await resolvePersonalAgentProjectCreate(input, {
    allowMissingAddonSecrets: opts?.allowMissingAddonSecrets === true,
  });
  if (!resolvedCreate.success) {
    return resolvedCreate;
  }

  const {
    name,
    budgetLimitUsd,
    agent,
    agentImpl,
    model,
    claudeAuthMode,
    codexAuthMode,
    runnerBackend,
    envOverrides,
    repoUrl,
    repoBranch,
    vpsServerType,
    providerBillingMode,
    sourceSeedProfile,
    proposalId,
    toolId,
    agentLoopVersionId,
    addons,
    addonRequiredSecrets,
    addonSecretValues,
  } = resolvedCreate;

  try {
    const ownerScopeId = opts?.ownerScopeId?.trim() || "arena-admin-api";
    const tgSpecSourceProjectId = opts?.tgSpecSourceProjectId?.trim() || null;
    const missingBlockingAddonSecrets = addonRequiredSecrets.filter((secret) => (
      secret.blocking !== false && !addonSecretValues[secret.key]
    ));

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          mode: "personal",
          ownerScopeType: "user",
          ownerScopeId,
          archivedAt: null,
          agent,
          agentImpl,
          model,
          envOverrides,
          claudeAuthMode,
          codexAuthMode,
          runnerBackend,
          toolId,
          agentLoopVersionId,
          proposalId,
          repoUrl,
          repoBranch,
          vpsServerType,
          providerBillingMode,
          visibility: "private",
          requiredSecrets: serializeRequiredSecrets(addonRequiredSecrets),
          ...(tgSpecSourceProjectId ? { tgSpecSourceProjectId } : {}),
          ...(addons.length > 0
            ? {
                specs: {
                  create: addons.map((addon, index) => ({
                    title: addon.specTitle,
                    content: addon.specContent,
                    orderIndex: index,
                    versions: {
                      create: buildProjectAddonSpecVersionCreate(addon),
                    },
                  })),
                },
              }
            : {}),
          ...(budgetLimitUsd != null && providerBillingMode !== "platform_credits"
            ? {
                budget: {
                  create: {
                    isEnabled: true,
                    totalCreditsUsd: budgetLimitUsd,
                    usedCreditsUsd: 0,
                  },
                },
              }
            : {}),
          components: {
            create: {
              name: "main",
              kind: "app",
              powerIntent: "OFF",
              agentIntent: "OFF",
              runtimeState: "ABSENT",
              agentState: null,
              ...(missingBlockingAddonSecrets.length > 0 ? { blockers: ["SECRETS"] } : {}),
              sourceType: repoUrl ? "git" : "managed",
              sourceConfig: {
                recipe: TG_SPEC_TARGET_RECIPE,
                ...(opts?.awaitingLaunchConfiguration
                  ? { launchConfiguration: TG_SPEC_LAUNCH_CONFIGURATION_REQUIRED }
                  : {}),
                repoUrl,
                repoBranch,
                agent,
                agentImpl,
                toolId,
                agentLoopVersionId,
                ...(sourceSeedProfile ? { sourceSeedProfile } : {}),
                ...(addons.length > 0 ? { addonIds: addons.map((addon) => addon.id) } : {}),
              },
              runtimeConfig: {
                model,
                cycleImage: DEFAULT_WORKER_IMAGE,
                runnerBackend,
                toolId,
                agentLoopVersionId,
                vpsServerType,
                ...(addons.length > 0 ? { addonIds: addons.map((addon) => addon.id) } : {}),
                ...(agentImpl === "dummy" ? { repoProvisioning: "skip" } : {}),
                useRepoHead: true,
              },
            },
          },
        },
        select: { id: true },
      });

      await createInitialProjectSecrets(tx, created.id, addonRequiredSecrets, addonSecretValues);

      await tx.project.update({
        where: { id: created.id },
        data: { slug: buildWorkspaceLabel(name, created.id) },
      });

      if (budgetLimitUsd != null && providerBillingMode === "platform_credits") {
        await reserveUserCreditsForProjectBudget(tx, {
          userId: ownerScopeId,
          projectId: created.id,
          amountUsd: budgetLimitUsd,
          note: "Initial Platform Credits budget",
        });
      }

      await tx.runLog.create({
        data: {
          projectId: created.id,
          event: "CREATED",
          detail: JSON.stringify({
            agent,
            agentImpl,
            model,
            personal: true,
            recipe: "tg_spec_target",
            awaitingFirstSpec: true,
            awaitingLaunchConfiguration: opts?.awaitingLaunchConfiguration === true,
            ...(tgSpecSourceProjectId ? { tgSpecSourceProjectId } : {}),
            ...(addons.length > 0 ? { addons: addons.map((addon) => addon.id) } : {}),
            ...(missingBlockingAddonSecrets.length > 0
              ? { missingRequiredSecrets: missingBlockingAddonSecrets.map((secret) => secret.key) }
              : {}),
            ...(repoUrl ? { repoUrl, repoBranch } : {}),
          }),
        },
      });

      if (missingBlockingAddonSecrets.length > 0) {
        await tx.runLog.create({
          data: {
            projectId: created.id,
            event: "SECRETS_BLOCKED",
            detail: JSON.stringify({
              reason: "tg_spec_addon_setup",
              missingSecrets: missingBlockingAddonSecrets.map((entry) => entry.key),
            }),
          },
        });
      }

      return created.id;
    });

    return finishCreate(project);
  } catch (error) {
    console.error("Create personal tg-spec target project error:", error);
    return { success: false as const, error: "Failed to create project" };
  }
}

export async function createPersonalTgSpecProject(input: CreatePersonalTgSpecProjectInput) {
  const authResult = await requireSignedInUser();
  if (!authResult.success) {
    return authResult;
  }
  const platformAccess = await resolvePlatformAccess(authResult.session as any, authResult.hasBypass);
  const resolvedCreate = await resolvePersonalAgentProjectCreate(input);
  if (!resolvedCreate.success) {
    return resolvedCreate;
  }
  const privileged = platformAccess.hasCapability("platform.projects.manage");
  if (resolvedCreate.providerBillingMode === "platform_credits" && resolvedCreate.budgetLimitUsd == null) {
    return { success: false as const, error: "Platform Credits launches require an initial budget." };
  }
  const policy = await enforceUserLaunchPolicy({
    userId: authResult.session.user.id,
    privileged,
    agent: resolvedCreate.agent,
    agentImpl: resolvedCreate.agentImpl,
    runnerBackend: resolvedCreate.runnerBackend,
    providerBillingMode: resolvedCreate.providerBillingMode,
  });
  if (!policy.allowed) {
    return { success: false as const, error: policy.error };
  }

  return createPersonalTgSpecProjectInternal(normalizeUserLaunchInput(input, resolvedCreate, privileged), {
    ownerScopeId: authResult.session.user.id,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
}

export async function createPersonalRecipeProject(input: CreatePersonalRecipeProjectInput) {
  const authResult = await requireSignedInUser();
  if (!authResult.success) {
    return authResult;
  }
  const { session } = authResult;

  const name = input.name.trim();
  if (!name) {
    return { success: false as const, error: "Project name is required" };
  }

  const budgetLimit = normalizeOptionalBudget(input.initialBudgetUsd);
  if (!budgetLimit.ok) {
    return { success: false as const, error: budgetLimit.error };
  }

  const runnerBackend = input.runnerBackend?.trim() || "local";
  const platformAccess = await resolvePlatformAccess(session as any, authResult.hasBypass);
  if (runnerBackend === "vps" && !platformAccess.hasCapability("platform.projects.manage")) {
    return { success: false as const, error: "Managed VPS launches are not available for user projects yet." };
  }
  const recipe = getProjectRecipe(input.recipeId);
  if (
    BYOK_RECIPE_IDS.has(recipe.id)
    && !platformAccess.hasCapability("platform.projects.manage")
    && !(await isByokProviderKeysEnabled())
  ) {
    return { success: false as const, error: "User provider API-key launches are disabled." };
  }
  const envOverrides = recipe.envOverrides ? JSON.stringify(recipe.envOverrides) : null;
  const recipeRuntimeConfig =
    recipe.component.runtimeConfig && typeof recipe.component.runtimeConfig === "object"
      ? recipe.component.runtimeConfig as Record<string, unknown>
      : {};
  const cycleImage =
    typeof recipeRuntimeConfig.cycleImage === "string" && recipeRuntimeConfig.cycleImage.trim()
      ? recipeRuntimeConfig.cycleImage
      : DEFAULT_WORKER_IMAGE;
  const blockingRequiredSecrets = recipe.requiredSecrets.filter((entry) => entry.blocking !== false);
  const powerIntent = blockingRequiredSecrets.length > 0 ? "OFF" : "ON";

  try {
    const projectId = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          mode: "personal",
          ownerScopeType: "user",
          ownerScopeId: session.user.id,
          archivedAt: null,
          agent: recipe.agent,
          agentImpl: recipe.agentImpl,
          envOverrides,
          runnerBackend,
          visibility: "private",
          requiredSecrets: serializeRequiredSecrets(recipe.requiredSecrets),
          ...(budgetLimit.value != null
            ? {
                budget: {
                  create: {
                    isEnabled: true,
                    totalCreditsUsd: budgetLimit.value,
                    usedCreditsUsd: 0,
                  },
                },
              }
            : {}),
          components: {
            create: {
              name: recipe.component.name,
              kind: recipe.component.kind,
              powerIntent,
              runtimeState: "ABSENT",
              agentState: null,
              blockers: blockingRequiredSecrets.length > 0 ? ["SECRETS"] : [],
              sourceType: recipe.component.sourceType,
              sourceConfig: recipe.component.sourceConfig as any,
              runtimeConfig: {
                ...recipeRuntimeConfig,
                cycleImage,
                runnerBackend,
              } as any,
            },
          },
        },
        select: { id: true },
      });

      // RA-216: Set immutable slug for runtime identity
      await tx.project.update({
        where: { id: created.id },
        data: { slug: buildWorkspaceLabel(name, created.id) },
      });

      await tx.runLog.create({
        data: {
          projectId: created.id,
          event: "LAUNCHED",
          detail: JSON.stringify({
            personal: true,
            recipe: recipe.id,
            agent: recipe.agent,
            agentImpl: recipe.agentImpl,
          }),
        },
      });

      if (blockingRequiredSecrets.length > 0) {
        await tx.runLog.create({
          data: {
            projectId: created.id,
            event: "SECRETS_BLOCKED",
            detail: JSON.stringify({
              reason: "initial_recipe_setup",
              missingSecrets: blockingRequiredSecrets.map((entry) => entry.key),
            }),
          },
        });
      }

      return created.id;
    });

    return finishCreate(projectId);
  } catch (error) {
    console.error("Create personal recipe project error:", error);
    return { success: false as const, error: "Failed to create project" };
  }
}

async function resolvePersonalAgentProjectCreate(
  input: CreatePersonalAgentProjectInput | CreatePersonalTgSpecProjectInput,
  options: ResolvePersonalAgentProjectCreateOptions = {},
): Promise<{ success: true } & ResolvedPersonalAgentProjectCreate | { success: false; error: string }> {
  const name = input.name.trim();
  if (!name) {
    return { success: false, error: "Project name is required" };
  }

  const budgetLimit = normalizeOptionalBudget(input.initialBudgetUsd);
  if (!budgetLimit.ok) {
    return { success: false, error: budgetLimit.error };
  }

  const agent = input.agent.trim();
  const agentImpl = input.agentImpl.trim();
  const model = input.model?.trim() || null;
  const claudeAuthMode = input.claudeAuthMode?.trim() || null;
  const codexAuthMode = input.codexAuthMode?.trim() || null;
  const runnerBackend = input.runnerBackend?.trim() || "local";
  const envOverrides = input.envOverrides ? JSON.stringify(input.envOverrides) : null;
  const repoUrl = input.repoUrl?.trim() || null;
  const repoBranch = input.repoBranch?.trim() || process.env.DEFAULT_PROJECT_BRANCH || "main";
  const vpsServerType = input.vpsServerType?.trim() || null;
  const rawProviderBillingMode = input.providerBillingMode?.trim() || null;
  const providerBillingMode = rawProviderBillingMode ? parseProviderBillingMode(rawProviderBillingMode) : "byok";
  if (!providerBillingMode) {
    return { success: false, error: `Invalid providerBillingMode: ${rawProviderBillingMode}` };
  }
  const rawSourceSeedProfile = "sourceSeedProfile" in input
    ? input.sourceSeedProfile?.trim() || null
    : null;
  const sourceSeedProfile = rawSourceSeedProfile ? parseSourceSeedProfile(rawSourceSeedProfile) : null;
  if (rawSourceSeedProfile && !sourceSeedProfile) {
    return { success: false, error: `Invalid sourceSeedProfile: ${rawSourceSeedProfile}` };
  }
  const proposalId = input.proposalId?.trim() || null;
  const addonResult = resolveProjectAddons(input.addonIds);
  if (!addonResult.success) {
    return addonResult;
  }
  const addonRequiredSecrets = collectAddonRequiredSecrets(addonResult.addons);
  const addonSecretResult = resolveAddonSecretValues(addonRequiredSecrets, input.addonSecretValues, {
    allowMissingBlockingSecrets: options.allowMissingAddonSecrets === true,
  });
  if (!addonSecretResult.success) {
    return addonSecretResult;
  }

  if (!agent || !agentImpl) {
    return { success: false, error: "Agent tool and loop are required" };
  }
  if (claudeAuthMode && !VALID_CLAUDE_AUTH_MODES.includes(claudeAuthMode as any)) {
    return { success: false, error: `Invalid claudeAuthMode: ${claudeAuthMode}` };
  }
  if (codexAuthMode && !VALID_CODEX_AUTH_MODES.includes(codexAuthMode as any)) {
    return { success: false, error: `Invalid codexAuthMode: ${codexAuthMode}` };
  }
  if (providerBillingMode === "platform_credits" && budgetLimit.value == null) {
    return { success: false, error: "Platform Credits launches require an initial budget." };
  }
  const authModes = normalizeAuthModesForProviderBilling(agent, providerBillingMode, {
    claudeAuthMode,
    codexAuthMode,
  });

  const resolvedTooling = await resolveLoopAndTool(agentImpl, agent);
  const toolId = input.toolId ?? resolvedTooling.toolId;
  const agentLoopVersionId = resolvedTooling.agentLoopVersionId;

  if (!toolId || !agentLoopVersionId) {
    return { success: false, error: `Unknown tool/loop mapping for ${agent} / ${agentImpl}` };
  }

  return {
    success: true,
    name,
    budgetLimitUsd: budgetLimit.value,
    agent,
    agentImpl,
    model,
    envOverrides,
    claudeAuthMode: authModes.claudeAuthMode,
    codexAuthMode: authModes.codexAuthMode,
    runnerBackend,
    toolId,
    agentLoopVersionId,
    proposalId,
    repoUrl,
    repoBranch,
    vpsServerType,
    providerBillingMode,
    sourceSeedProfile,
    addons: addonResult.addons,
    addonRequiredSecrets,
    addonSecretValues: addonSecretResult.values,
  };
}
