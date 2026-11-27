"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { encryptSecret, decryptSecret, getEncryptionKey } from "@/lib/crypto";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { getProjectProposalPath } from "@/lib/project-identity";
import {
  requireAnyProjectCapability,
  requireProjectCapability,
} from "@/lib/project-access";
import { requirePlatformCapability } from "@/lib/platform-access";
import { restartContainerInternal } from "@/app/actions/container-ops";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  resetComponentForFreshStart,
} from "@/lib/project-state-effects";
import {
  mergeRequiredSecrets,
  normalizeRequiredSecretKey,
  parseRequiredSecrets,
  isValidRequiredSecretKey,
  type RequiredSecretEntry,
} from "@/lib/required-secrets";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { hasLivePreviewFact } from "@/lib/preview-state";
import { requireProjectRuntimeActionAccess } from "@/lib/runtime-action-access";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";
import { enqueueProjectUpdate } from "@/lib/project-update-outbox";

type TransactionClient = Prisma.TransactionClient;

// ── Types ────────────────────────────────────────────────────

type SecretActionResult = {
  success: boolean;
  error?: string;
};

type SecretMutationOpts = {
  allowManagedVpsResume?: boolean;
  allowUserProviderRunResume?: boolean;
  internalActionToken?: unknown;
};

import type { SecretListItem } from "@/lib/action-types";

async function restartDeployedProjectApp(projectId: string, opts: SecretMutationOpts = {}): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      runnerBackend: true,
      components: {
        orderBy: { createdAt: "asc" as const },
        take: 1,
        select: {
          kind: true,
          powerIntent: true,
          agentIntent: true,
          runtimeState: true,
          agentState: true,
          lastOutcome: true,
          previewHealth: true,
          previewUrl: true,
          containerName: true,
          vpsHostId: true,
        },
      },
    },
  });

  if (!project) return;
  const primaryComponent = getPrimaryLifecycleComponent(project);
  if (!primaryComponent?.containerName) return;
  if (((project.runnerBackend ?? "local") === "vps" || primaryComponent.vpsHostId) && opts.allowManagedVpsResume !== true) return;
  const isLivePreview = hasLivePreviewFact(primaryComponent);
  if (!isLivePreview) return;

  const result = await restartContainerInternal(projectId, INTERNAL_ACTION_TOKEN);
  if (!result.success) {
    throw new Error(result.error || "Restart failed");
  }

  await prisma.runLog.create({
    data: {
      projectId,
      event: "DEPLOYED",
      detail: JSON.stringify({ trigger: "secret_restart" }),
    },
  });

  revalidatePath("/admin");

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
}

async function requeueRunsWaitingForSecrets(projectId: string, opts: SecretMutationOpts = {}): Promise<number> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      proposalId: true,
      runnerBackend: true,
      requiredSecrets: true,
      secrets: { select: { key: true } },
    },
  });

  if (!project) return 0;

  const blockingRequired = parseRequiredSecrets(project.requiredSecrets)
    .filter((entry) => entry.blocking !== false)
    .map((entry) => entry.key);
  const providedKeys = new Set<string>((project.secrets ?? []).map((secret: { key: string }) => secret.key));
  const missingBlocking = blockingRequired.filter((key) => !providedKeys.has(key));

  if (missingBlocking.length > 0) {
    return 0;
  }

  // Check if project itself is paused due to missing secrets
  const primaryComponent = await requirePrimaryComponentRow(prisma, projectId).catch(() => null);
  const isPausedForSecrets = primaryComponent
    ? primaryComponent.blockers.includes("SECRETS")
    : false;

  if (!isPausedForSecrets) return 0;
  if (((project.runnerBackend ?? "local") === "vps" || primaryComponent?.vpsHostId) && opts.allowManagedVpsResume !== true) {
    return 0;
  }
  if (opts.allowUserProviderRunResume === false) {
    return 0;
  }

  const resumeCtx = { source: "admin" as const, trigger: "secrets_provided", reason: "all blocking secrets now provided" };
  const repairCtx = {
    source: "system" as const,
    trigger: "secrets_provided",
    reason: "normalize runtime identity after secrets resume",
  };
  const remainingBlockers = primaryComponent
    ? primaryComponent.blockers.filter((blocker) => blocker !== "SECRETS")
    : [];
  await prisma.$transaction(async (tx: TransactionClient) => {
    // Remove SECRETS blocker
    await applyStateChange(tx, projectId, { type: "removeBlocker", blocker: "SECRETS" }, resumeCtx);

    // secrets_provided is a boundary repair: the runner may already be gone,
    // so we must reset stale runtime identity explicitly instead of leaving a false RUNNING tuple behind.
    if (!primaryComponent) {
      return;
    }

    await resetComponentForFreshStart(tx, projectId, repairCtx);

    if (remainingBlockers.length === 0 && primaryComponent.powerIntent !== "ON") {
      await applyStateChange(tx, projectId, { type: "power", intent: "ON" }, resumeCtx);
    }

    await tx.runLog.create({
      data: { projectId, event: "PROVISIONING", detail: JSON.stringify({ trigger: "secrets-provided" }) },
    });

    await enqueueProjectUpdate(tx, {
      projectId,
      eventType: "required_secret.provided",
      dedupeKey: `secrets-provided:${blockingRequired.slice().sort().join(",")}:${new Date().toISOString()}`,
      payload: {
        requiredSecretKeys: blockingRequired,
      },
    });
  });

  revalidatePath("/admin");

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  const proposalPath = getProjectProposalPath(project);
  if (proposalPath) revalidatePath(proposalPath);

  return 1;
}

// ── Actions ──────────────────────────────────────────────────

export async function listProjectSecrets(
  projectId: string,
): Promise<SecretListItem[]> {
  const access = await requireProjectCapability(projectId, "project.secrets.manage");
  if (!access.authorized) return [];

  return prisma.projectSecret.findMany({
    where: { projectId },
    select: {
      id: true,
      key: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { key: "asc" },
  });
}

export async function createProjectSecret(
  projectId: string,
  key: string,
  value: string,
  description?: string,
): Promise<SecretActionResult> {
  const access = await requireProjectCapability(projectId, "project.secrets.manage");
  if (!access.authorized) return { success: false, error: access.error };
  const platformRuntimeAccess = await requirePlatformCapability("platform.runtime.manage");
  const runtimeGuard = await requireProjectRuntimeActionAccess(projectId);

  return createProjectSecretInternal(projectId, key, value, description, {
    allowManagedVpsResume: platformRuntimeAccess.authorized,
    allowUserProviderRunResume: runtimeGuard === null,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
}

export async function createProjectSecretInternal(
  projectId: string,
  key: string,
  value: string,
  description?: string,
  opts: SecretMutationOpts = { allowManagedVpsResume: true },
): Promise<SecretActionResult> {
  const internalGuard = requireInternalActionToken(opts.internalActionToken);
  if (internalGuard) return internalGuard;

  const trimmedKey = normalizeRequiredSecretKey(key);
  if (!trimmedKey || !isValidRequiredSecretKey(trimmedKey)) {
    return {
      success: false,
      error: "Key must be a valid env var name (A-Z, 0-9, _)",
    };
  }
  if (!value) {
    return { success: false, error: "Value is required" };
  }

  try {
    const encKey = getEncryptionKey();
    const encrypted = encryptSecret(value, encKey);

    await (prisma as any).projectSecret.create({
      data: {
        projectId,
        key: trimmedKey,
        encryptedValue: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        description: description?.trim() || null,
      },
    });

    const requeued = await requeueRunsWaitingForSecrets(projectId, opts);
    if (requeued > 0) {
      console.log(`[secrets] RA-074: Re-queued ${requeued} run(s) for project ${projectId} after secret create`);
    }

    try {
      await restartDeployedProjectApp(projectId, opts);
    } catch (error) {
      console.error(`[secrets] RA-122: failed to restart deployed app for project ${projectId}:`, error);
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/my/projects/${projectId}`);
    revalidatePath("/my");
    notifyProjectChanged(projectId);
    return { success: true };
  } catch (error: any) {
    if (error?.code === "P2002") {
      return {
        success: false,
        error: `Secret "${trimmedKey}" already exists for this project`,
      };
    }
    console.error("Create secret error:", error);
    return { success: false, error: "Failed to create secret" };
  }
}

export async function updateProjectSecret(
  secretId: string,
  value?: string,
  description?: string,
): Promise<SecretActionResult> {
  try {
    const existing = await (prisma as any).projectSecret.findUnique({
      where: { id: secretId },
      select: { id: true, projectId: true },
    });
    if (!existing) return { success: false, error: "Secret not found" };
    const access = await requireProjectCapability(existing.projectId, "project.secrets.manage");
    if (!access.authorized) return { success: false, error: access.error };
    const platformRuntimeAccess = await requirePlatformCapability("platform.runtime.manage");
    const runtimeGuard = await requireProjectRuntimeActionAccess(existing.projectId);
    const opts = {
      allowManagedVpsResume: platformRuntimeAccess.authorized,
      allowUserProviderRunResume: runtimeGuard === null,
    };

    const data: Record<string, any> = {};
    if (description !== undefined) {
      data.description = description.trim() || null;
    }
    if (value !== undefined && value !== "") {
      const encKey = getEncryptionKey();
      const encrypted = encryptSecret(value, encKey);
      data.encryptedValue = encrypted.ciphertext;
      data.iv = encrypted.iv;
      data.authTag = encrypted.authTag;
    }

    if (Object.keys(data).length === 0) {
      return { success: true };
    }

    await (prisma as any).projectSecret.update({
      where: { id: secretId },
      data,
    });

    if (value !== undefined && value !== "") {
      const requeued = await requeueRunsWaitingForSecrets(existing.projectId, opts);
      if (requeued > 0) {
        console.log(`[secrets] RA-074: Re-queued ${requeued} run(s) for project ${existing.projectId} after secret update`);
      }
      try {
        await restartDeployedProjectApp(existing.projectId, opts);
      } catch (error) {
        console.error(`[secrets] RA-122: failed to restart deployed app for project ${existing.projectId}:`, error);
      }
    }

    revalidatePath(`/admin/projects/${existing.projectId}`);
    revalidatePath(`/my/projects/${existing.projectId}`);
    revalidatePath("/my");
    notifyProjectChanged(existing.projectId);
    return { success: true };
  } catch (error) {
    console.error("Update secret error:", error);
    return { success: false, error: "Failed to update secret" };
  }
}

export async function deleteProjectSecret(
  secretId: string,
): Promise<SecretActionResult> {
  try {
    const existing = await (prisma as any).projectSecret.findUnique({
      where: { id: secretId },
      select: { id: true, projectId: true },
    });
    if (!existing) return { success: false, error: "Secret not found" };
    const access = await requireProjectCapability(existing.projectId, "project.secrets.manage");
    if (!access.authorized) return { success: false, error: access.error };

    await (prisma as any).projectSecret.delete({ where: { id: secretId } });

    revalidatePath(`/admin/projects/${existing.projectId}`);
    revalidatePath(`/my/projects/${existing.projectId}`);
    revalidatePath("/my");
    notifyProjectChanged(existing.projectId);
    return { success: true };
  } catch (error) {
    console.error("Delete secret error:", error);
    return { success: false, error: "Failed to delete secret" };
  }
}

export async function revealProjectSecret(
  secretId: string,
): Promise<{ success: true; value: string } | { success: false; error: string }> {
  try {
    const secret = await (prisma as any).projectSecret.findUnique({
      where: { id: secretId },
    });
    if (!secret) return { success: false, error: "Secret not found" };
    const access = await requireProjectCapability(secret.projectId, "project.secrets.reveal");
    if (!access.authorized) return { success: false, error: access.error };

    const encKey = getEncryptionKey();
    const decrypted = decryptSecret(
      {
        ciphertext: secret.encryptedValue,
        iv: secret.iv,
        authTag: secret.authTag,
      },
      encKey,
    );
    return { success: true, value: decrypted };
  } catch (error) {
    console.error("Reveal secret error:", error);
    return { success: false, error: "Failed to decrypt secret" };
  }
}

export async function getRequiredSecrets(
  projectId: string,
): Promise<RequiredSecretEntry[]> {
  const access = await requireAnyProjectCapability(projectId, [
    "project.required_secrets.manage",
    "project.secrets.manage",
  ]);
  if (!access.authorized) return [];

  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: { requiredSecrets: true },
  });
  return parseRequiredSecrets(project?.requiredSecrets);
}

export async function addRequiredSecret(
  projectId: string,
  key: string,
  description?: string,
): Promise<SecretActionResult> {
  const access = await requireProjectCapability(projectId, "project.required_secrets.manage");
  if (!access.authorized) return { success: false, error: access.error };

  const trimmedKey = normalizeRequiredSecretKey(key);
  if (!trimmedKey || !isValidRequiredSecretKey(trimmedKey)) {
    return { success: false, error: "Key must be a valid env var name (A-Z, 0-9, _)" };
  }

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: { requiredSecrets: true },
    });
    const list = parseRequiredSecrets(project?.requiredSecrets);

    if (list.some((e) => e.key === trimmedKey)) {
      return { success: false, error: `"${trimmedKey}" is already in the required list` };
    }

    list.push({ key: trimmedKey, ...(description?.trim() ? { description: description.trim() } : {}), blocking: true });

    await (prisma as any).project.update({
      where: { id: projectId },
      data: { requiredSecrets: JSON.stringify(list) },
    });

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/my/projects/${projectId}`);
    revalidatePath("/my");
    notifyProjectChanged(projectId);
    return { success: true };
  } catch (error) {
    console.error("Add required secret error:", error);
    return { success: false, error: "Failed to add required secret" };
  }
}

export async function removeRequiredSecret(
  projectId: string,
  key: string,
): Promise<SecretActionResult> {
  const access = await requireProjectCapability(projectId, "project.required_secrets.manage");
  if (!access.authorized) return { success: false, error: access.error };

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: { requiredSecrets: true },
    });
    const list = parseRequiredSecrets(project?.requiredSecrets);
    const filtered = list.filter((e) => e.key !== key);

    await (prisma as any).project.update({
      where: { id: projectId },
      data: { requiredSecrets: filtered.length > 0 ? JSON.stringify(filtered) : null },
    });

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/my/projects/${projectId}`);
    revalidatePath("/my");
    notifyProjectChanged(projectId);
    return { success: true };
  } catch (error) {
    console.error("Remove required secret error:", error);
    return { success: false, error: "Failed to remove required secret" };
  }
}

/**
 * Merge agent-requested secrets into the project's requiredSecrets list.
 * Called by the dispatcher when agents request secrets via the Secrets API.
 * Entries that already exist (by key) are not duplicated.
 */
export async function syncRequiredSecretsFromAgent(
  projectId: string,
  entries: RequiredSecretEntry[],
): Promise<void> {
  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: { requiredSecrets: true },
  });
  const existing = parseRequiredSecrets(project?.requiredSecrets);
  const { list, changed } = mergeRequiredSecrets(existing, entries);

  if (changed) {
    await (prisma as any).project.update({
      where: { id: projectId },
      data: { requiredSecrets: JSON.stringify(list) },
    });
  }
}
