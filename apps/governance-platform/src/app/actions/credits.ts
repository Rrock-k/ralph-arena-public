import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { creditsForPlan } from "@/lib/credit-plans";
import { logError } from "@/lib/errors";
import { isManagedProviderCreditsEnabled } from "@/lib/feature-flags";

type TransactionClient = Prisma.TransactionClient;

type GrantResult = {
  success: boolean;
  error?: string;
  credits?: number;
};

export type UserCreditLedgerEntry = {
  id: string;
  source: "purchase" | "admin" | "project_reserve" | "refund" | "adjustment";
  kind: string;
  label: string;
  creditsDelta: number;
  amountUsd: number | null;
  note: string | null;
  createdAt: Date;
  projectId: string | null;
  projectName: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

function labelForAdjustmentKind(kind: string): {
  source: UserCreditLedgerEntry["source"];
  label: string;
} {
  if (kind === "ADMIN_CREDIT_GRANT" || kind === "ADMIN_ADJUST") {
    return { source: "admin", label: "Admin credit grant" };
  }
  if (kind === "PROJECT_BUDGET_RESERVE") {
    return { source: "project_reserve", label: "Reserved for project budget" };
  }
  if (kind === "REFUND") {
    return { source: "refund", label: "Credit refund" };
  }
  return { source: "adjustment", label: kind.replaceAll("_", " ").toLowerCase() };
}

// Internal grant primitive. Callers must verify the user/license/webhook boundary before passing a userId.
export async function grantCreditsInternal(
  userId: string,
  planId: string,
  freemiusLicenseId: string | null,
): Promise<GrantResult> {
  if (!(await isManagedProviderCreditsEnabled())) {
    return { success: false, error: "Platform Credits are disabled." };
  }

  const plan = creditsForPlan(planId);
  if (!plan) {
    logError("E-CRED-001", { planId });
    return { success: false, error: "Unknown plan" };
  }

  // Dedup by freemiusLicenseId
  if (freemiusLicenseId) {
    const existing = await prisma.creditPurchase.findUnique({
      where: { freemiusLicenseId },
    });
    if (existing) {
      return { success: true, credits: plan.credits }; // already granted, idempotent
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    logError("E-CRED-003", { userId });
    return { success: false, error: "User not found" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.creditPurchase.create({
      data: {
        userId,
        planId,
        planTitle: plan.title,
        amountUsd: plan.priceUsd,
        creditsGranted: plan.credits,
        freemiusLicenseId,
      },
    });

    await tx.userCreditBalance.upsert({
      where: { userId },
      create: { userId, credits: plan.credits },
      update: { credits: { increment: plan.credits } },
    });
  });

  const balance = await prisma.userCreditBalance.findUnique({
    where: { userId },
    select: { credits: true },
  });

  return { success: true, credits: balance?.credits ?? plan.credits };
}

export async function getUserCreditBalance(userId: string): Promise<number> {
  const balance = await prisma.userCreditBalance.findUnique({
    where: { userId },
    select: { credits: true },
  });
  return balance?.credits ?? 0;
}

export async function getUserPurchaseHistory(userId: string) {
  return prisma.creditPurchase.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

export async function getUserCreditLedgerHistory(
  userId: string,
  take = 30,
  opts: { includeActor?: boolean } = {},
): Promise<UserCreditLedgerEntry[]> {
  const [purchases, adjustments] = await Promise.all([
    prisma.creditPurchase.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
    }),
    (prisma as any).userCreditAdjustment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        project: { select: { id: true, name: true, proposal: { select: { title: true } } } },
        ...(opts.includeActor
          ? { createdBy: { select: { id: true, name: true, email: true } } }
          : {}),
      },
    }),
  ]);

  return [
    ...purchases.map((purchase) => ({
      id: purchase.id,
      source: "purchase" as const,
      kind: "FREEMIUS_PURCHASE",
      label: `${purchase.planTitle} purchase`,
      creditsDelta: purchase.creditsGranted,
      amountUsd: purchase.amountUsd,
      note: null,
      createdAt: purchase.createdAt,
      projectId: null,
      projectName: null,
      actorId: null,
      actorName: null,
      actorEmail: null,
    })),
    ...adjustments.map((adjustment: any) => {
      const meta = labelForAdjustmentKind(adjustment.kind);
      return {
        id: adjustment.id,
        source: meta.source,
        kind: adjustment.kind,
        label: meta.label,
        creditsDelta: adjustment.amountUsd,
        amountUsd: null,
        note: adjustment.note ?? null,
        createdAt: adjustment.createdAt,
        projectId: adjustment.projectId ?? null,
        projectName: adjustment.project?.name ?? adjustment.project?.proposal?.title ?? null,
        actorId: opts.includeActor ? adjustment.createdById ?? adjustment.createdBy?.id ?? null : null,
        actorName: opts.includeActor ? adjustment.createdBy?.name ?? null : null,
        actorEmail: opts.includeActor ? adjustment.createdBy?.email ?? null : null,
      };
    }),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, take);
}

export async function reserveUserCreditsForProjectBudget(
  tx: TransactionClient,
  input: {
    userId: string;
    projectId: string;
    amountUsd: number;
    note?: string | null;
  },
): Promise<{ totalCreditsUsd: number; usedCreditsUsd: number; remainingUserCredits: number }> {
  const amountUsd = Number(input.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 0.11) {
    throw new Error("Platform Credits budget must be at least $0.11");
  }

  const normalizedAmount = Math.round(amountUsd * 100) / 100;
  const debit = await (tx as any).userCreditBalance.updateMany({
    where: {
      userId: input.userId,
      credits: { gte: normalizedAmount },
    },
    data: {
      credits: { decrement: normalizedAmount },
    },
  });

  if (debit.count !== 1) {
    throw new Error("Not enough user credits. Buy credits in Settings before using Platform Credits.");
  }

  const balance = await (tx as any).userCreditBalance.findUnique({
    where: { userId: input.userId },
    select: { credits: true },
  });

  await (tx as any).userCreditAdjustment.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      amountUsd: -normalizedAmount,
      kind: "PROJECT_BUDGET_RESERVE",
      note: input.note ?? null,
    },
  });

  const budget = await (tx as any).projectBudget.upsert({
    where: { projectId: input.projectId },
    create: {
      projectId: input.projectId,
      isEnabled: true,
      totalCreditsUsd: normalizedAmount,
      usedCreditsUsd: 0,
      note: input.note ?? null,
    },
    update: {
      isEnabled: true,
      totalCreditsUsd: { increment: normalizedAmount },
      note: input.note ?? undefined,
    },
    select: {
      totalCreditsUsd: true,
      usedCreditsUsd: true,
    },
  });

  await (tx as any).projectBudgetAdjustment.create({
    data: {
      projectId: input.projectId,
      createdById: input.userId,
      amountUsd: normalizedAmount,
      kind: "TOP_UP",
      note: input.note ?? "Reserved from user credits",
    },
  });

  return {
    totalCreditsUsd: budget.totalCreditsUsd,
    usedCreditsUsd: budget.usedCreditsUsd,
    remainingUserCredits: balance?.credits ?? 0,
  };
}
