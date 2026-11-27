"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { tryAutoResumePausedRun } from "@/lib/budget-resume";
import { requirePlatformCapability } from "@/lib/platform-access";
import { requireProjectCapability } from "@/lib/project-access";
import { reserveUserCreditsForProjectBudget } from "@/app/actions/credits";
import { enforceUserLaunchPolicy } from "@/lib/user-launch-policy";
import { INTERNAL_ACTION_TOKEN, requireInternalActionToken } from "@/lib/internal-action-token";

type TransactionClient = Prisma.TransactionClient;

type BudgetActionResult = {
  success: boolean;
  error?: string;
  totalCreditsUsd?: number;
  usedCreditsUsd?: number;
  remainingUsd?: number;
  resumedProjectId?: string;
};

type BudgetMutationOpts = {
  createdById?: string | null;
  allowManagedVpsResume?: boolean;
  allowUserProviderRunResume?: boolean;
  internalActionToken?: unknown;
};

function budgetSuccess(totalCreditsUsd: number, usedCreditsUsd: number): BudgetActionResult {
  return {
    success: true,
    totalCreditsUsd,
    usedCreditsUsd,
    remainingUsd: totalCreditsUsd - usedCreditsUsd,
  };
}

function revalidateBudgetPaths(projectId: string): void {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin");
}

async function requireBudgetAdmin(): Promise<
  | { success: true; createdById: string | null }
  | { success: false; error: string }
> {
  const access = await requirePlatformCapability("platform.finance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  return { success: true, createdById: access.session?.user?.id ?? null };
}

async function requireProjectBudgetManager(projectId: string): Promise<
  | { success: true; createdById: string | null; sessionUserId: string | null; allowManagedVpsResume: boolean; platformFinance: boolean }
  | { success: false; error: string }
> {
  const [platformAccess, platformRuntimeAccess, projectAccess] = await Promise.all([
    requirePlatformCapability("platform.finance.manage"),
    requirePlatformCapability("platform.runtime.manage"),
    requireProjectCapability(projectId, "project.budget.manage"),
  ]);

  if (platformAccess.authorized) {
    return {
      success: true,
      createdById: platformAccess.session?.user?.id ?? null,
      sessionUserId: platformAccess.session?.user?.id ?? null,
      allowManagedVpsResume: platformRuntimeAccess.authorized,
      platformFinance: true,
    };
  }
  if (projectAccess.authorized) {
    return {
      success: true,
      createdById: projectAccess.session?.user?.id ?? null,
      sessionUserId: projectAccess.session?.user?.id ?? null,
      allowManagedVpsResume: platformRuntimeAccess.authorized,
      platformFinance: false,
    };
  }

  return { success: false, error: projectAccess.error ?? platformAccess.error };
}

async function resolveBudgetAutoResumeGate(
  projectId: string,
  opts: { platformFinance: boolean },
): Promise<{ allowed: true } | { allowed: false; error: string }> {
  if (!opts.platformFinance) {
    const runtimeAccess = await requireProjectCapability(projectId, "project.runtime.manage");
    if (!runtimeAccess.authorized) {
      return { allowed: false, error: "Project runtime access is required to resume this project." };
    }
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerScopeType: true,
      ownerScopeId: true,
      agent: true,
      agentImpl: true,
      runnerBackend: true,
      providerBillingMode: true,
    },
  });
  if (!project) return { allowed: false, error: "Project not found" };
  if (opts.platformFinance || project.ownerScopeType !== "user") return { allowed: true };

  const policy = await enforceUserLaunchPolicy({
    userId: project.ownerScopeId,
    privileged: false,
    agent: project.agent,
    agentImpl: project.agentImpl,
    runnerBackend: project.runnerBackend,
    providerBillingMode: project.providerBillingMode,
  });
  return policy.allowed ? { allowed: true } : { allowed: false, error: policy.error };
}

export async function addProjectCreditsInternal(
  projectId: string,
  amountUsd: number,
  note?: string,
  opts?: BudgetMutationOpts,
) {
  return adjustProjectBudgetInternal(projectId, amountUsd, note, opts);
}

export async function addProjectCredits(
  projectId: string,
  amountUsd: number,
  note?: string,
) {
  return adjustProjectBudget(projectId, amountUsd, note);
}

export async function adjustProjectBudgetInternal(
  projectId: string,
  amountUsd: number,
  note?: string,
  opts?: BudgetMutationOpts,
): Promise<BudgetActionResult> {
  const internalGuard = requireInternalActionToken(opts?.internalActionToken);
  if (internalGuard) return internalGuard;

  if (!Number.isFinite(amountUsd) || amountUsd === 0) {
    return { success: false, error: "Amount must be non-zero" };
  }

  if (amountUsd < 0 && !note?.trim()) {
    return { success: false, error: "Note is required for budget debit" };
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      const existing = await tx.projectBudget.findUnique({
        where: { projectId },
        select: { totalCreditsUsd: true, usedCreditsUsd: true, isEnabled: true },
      });

      const currentTotal = existing?.totalCreditsUsd ?? 0;
      const currentUsed = existing?.usedCreditsUsd ?? 0;
      const nextTotal = currentTotal + amountUsd;

      if (nextTotal < 0) {
        throw new Error("Budget total cannot be negative");
      }

      if (nextTotal < currentUsed) {
        throw new Error(`Budget cannot be lower than used amount ($${currentUsed.toFixed(2)})`);
      }

      const budget = await tx.projectBudget.upsert({
        where: { projectId },
        create: {
          projectId,
          isEnabled: true,
          totalCreditsUsd: nextTotal,
          usedCreditsUsd: 0,
          note: note || null,
        },
        update: {
          isEnabled: true,
          totalCreditsUsd: nextTotal,
          note: note || undefined,
        },
        select: {
          totalCreditsUsd: true,
          usedCreditsUsd: true,
        },
      });

      await tx.projectBudgetAdjustment.create({
        data: {
          projectId,
          createdById: opts?.createdById ?? null,
          amountUsd,
          kind: amountUsd > 0 ? "TOP_UP" : "DEBIT",
          note: note?.trim() || null,
        },
      });

      const resumedProjectId = amountUsd > 0
        ? await tryAutoResumePausedRun(tx, projectId, budget.totalCreditsUsd - budget.usedCreditsUsd, {
            allowManagedVpsResume: opts?.allowManagedVpsResume ?? true,
            allowUserProviderRunResume: opts?.allowUserProviderRunResume ?? true,
          })
        : null;

      return { ...budget, resumedProjectId };
    });

    notifyProjectChanged(projectId);

    return { ...budgetSuccess(result.totalCreditsUsd, result.usedCreditsUsd), resumedProjectId: result.resumedProjectId ?? undefined };
  } catch (error) {
    console.error("Adjust budget error:", error);
    const message = error instanceof Error ? error.message : "Failed to adjust budget";
    return { success: false, error: message };
  }
}

export async function adjustProjectBudget(
  projectId: string,
  amountUsd: number,
  note?: string,
): Promise<BudgetActionResult> {
  const authResult = await requireProjectBudgetManager(projectId);
  if (!authResult.success) return authResult;

  if (!authResult.platformFinance) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, providerBillingMode: true },
    });
    if (!project) {
      return { success: false, error: "Project not found" };
    }
    const autoResumeGate = await resolveBudgetAutoResumeGate(projectId, {
      platformFinance: authResult.platformFinance,
    });
    if (project.providerBillingMode !== "platform_credits") {
      const result = await adjustProjectBudgetInternal(projectId, amountUsd, note, {
        createdById: authResult.createdById,
        allowManagedVpsResume: authResult.allowManagedVpsResume,
        allowUserProviderRunResume: autoResumeGate.allowed,
        internalActionToken: INTERNAL_ACTION_TOKEN,
      });
      if (result.success) revalidateBudgetPaths(projectId);
      return result;
    }

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return { success: false, error: "Project credit debits require finance admin." };
    }
    if (!authResult.sessionUserId) {
      return { success: false, error: "A signed-in user is required to use Platform Credits." };
    }
    if (!autoResumeGate.allowed) {
      return { success: false, error: autoResumeGate.error };
    }

    try {
      const result = await prisma.$transaction(async (tx: TransactionClient) => {
        const reserved = await reserveUserCreditsForProjectBudget(tx, {
          userId: authResult.sessionUserId!,
          projectId,
          amountUsd,
          note: note?.trim() || "Platform Credits top-up",
        });
        const resumedProjectId = await tryAutoResumePausedRun(
          tx,
          projectId,
          reserved.totalCreditsUsd - reserved.usedCreditsUsd,
          {
            allowManagedVpsResume: authResult.allowManagedVpsResume,
            allowUserProviderRunResume: true,
          },
        );
        return { ...reserved, resumedProjectId };
      });

      notifyProjectChanged(projectId);
      revalidateBudgetPaths(projectId);
      return {
        ...budgetSuccess(result.totalCreditsUsd, result.usedCreditsUsd),
        resumedProjectId: result.resumedProjectId ?? undefined,
      };
    } catch (error) {
      console.error("Reserve platform credits error:", error);
      const message = error instanceof Error ? error.message : "Failed to reserve Platform Credits";
      return { success: false, error: message };
    }
  }

  const result = await adjustProjectBudgetInternal(projectId, amountUsd, note, {
    createdById: authResult.createdById,
    allowManagedVpsResume: authResult.allowManagedVpsResume,
    allowUserProviderRunResume: true,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
  if (result.success) revalidateBudgetPaths(projectId);
  return result;
}

export async function setProjectBudgetLimitInternal(
  projectId: string,
  totalCreditsUsd: number,
  isEnabled: boolean,
  note?: string,
  opts?: BudgetMutationOpts,
): Promise<BudgetActionResult> {
  const internalGuard = requireInternalActionToken(opts?.internalActionToken);
  if (internalGuard) return internalGuard;

  if (!Number.isFinite(totalCreditsUsd) || totalCreditsUsd < 0) {
    return { success: false, error: "Budget limit must be zero or positive" };
  }

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      const existing = await tx.projectBudget.findUnique({
        where: { projectId },
        select: { totalCreditsUsd: true, usedCreditsUsd: true },
      });

      const used = existing?.usedCreditsUsd ?? 0;
      if (totalCreditsUsd < used) {
        throw new Error(`Budget limit cannot be lower than used amount ($${used.toFixed(2)})`);
      }

      const delta = totalCreditsUsd - (existing?.totalCreditsUsd ?? 0);
      const budget = await tx.projectBudget.upsert({
        where: { projectId },
        create: {
          projectId,
          isEnabled,
          totalCreditsUsd,
          usedCreditsUsd: 0,
          note: note || null,
        },
        update: {
          isEnabled,
          totalCreditsUsd,
          note: note || undefined,
        },
        select: {
          totalCreditsUsd: true,
          usedCreditsUsd: true,
        },
      });

      await tx.projectBudgetAdjustment.create({
        data: {
          projectId,
          createdById: opts?.createdById ?? null,
          amountUsd: delta,
          kind: "SET_LIMIT",
          note: note?.trim() || null,
        },
      });

      const resumedProjectId = isEnabled
        ? await tryAutoResumePausedRun(tx, projectId, budget.totalCreditsUsd - budget.usedCreditsUsd, {
            allowManagedVpsResume: opts?.allowManagedVpsResume ?? true,
            allowUserProviderRunResume: opts?.allowUserProviderRunResume ?? true,
          })
        : null;

      return { ...budget, resumedProjectId };
    });

    notifyProjectChanged(projectId);

    return { ...budgetSuccess(result.totalCreditsUsd, result.usedCreditsUsd), resumedProjectId: result.resumedProjectId ?? undefined };
  } catch (error) {
    console.error("Set budget limit error:", error);
    const message = error instanceof Error ? error.message : "Failed to set budget limit";
    return { success: false, error: message };
  }
}

export async function setProjectBudgetLimit(
  projectId: string,
  totalCreditsUsd: number,
  isEnabled: boolean,
  note?: string,
): Promise<BudgetActionResult> {
  const authResult = await requireProjectBudgetManager(projectId);
  if (!authResult.success) return authResult;

  if (!authResult.platformFinance) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, providerBillingMode: true },
    });
    if (!project) {
      return { success: false, error: "Project not found" };
    }
    if (project.providerBillingMode === "platform_credits") {
      return { success: false, error: "Use Add Credits to fund Platform Credits projects." };
    }
  }

  const autoResumeGate = await resolveBudgetAutoResumeGate(projectId, {
    platformFinance: authResult.platformFinance,
  });

  const result = await setProjectBudgetLimitInternal(projectId, totalCreditsUsd, isEnabled, note, {
    createdById: authResult.createdById,
    allowManagedVpsResume: authResult.allowManagedVpsResume,
    allowUserProviderRunResume: autoResumeGate.allowed,
    internalActionToken: INTERNAL_ACTION_TOKEN,
  });
  if (result.success) revalidateBudgetPaths(projectId);
  return result;
}
