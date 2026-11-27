import { prisma } from "@/lib/prisma";

export const BUDGET_THRESHOLD_USD = 0.10;

export type BudgetGuardResult = {
  allowed: boolean;
  remainingUsd: number;
  error?: string;
};

export const PLATFORM_CREDITS_BUDGET_REQUIRED_MESSAGE = "Platform Credits project requires a funded budget.";

export async function enforceProjectBudget(projectId: string): Promise<BudgetGuardResult> {
  const budget = await (prisma as any).projectBudget.findUnique({
    where: { projectId },
    select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
  });

  // Opt-in budget guard. Managed Platform Credits paths must use enforceRequiredProjectBudget.
  if (!budget || !budget.isEnabled) {
    return { allowed: true, remainingUsd: Number.POSITIVE_INFINITY };
  }

  const remainingUsd = budget.totalCreditsUsd - budget.usedCreditsUsd;
  return {
    allowed: remainingUsd > BUDGET_THRESHOLD_USD,
    remainingUsd,
  };
}

export async function enforceRequiredProjectBudget(projectId: string): Promise<BudgetGuardResult> {
  const budget = await (prisma as any).projectBudget.findUnique({
    where: { projectId },
    select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
  });

  if (!budget || !budget.isEnabled) {
    return {
      allowed: false,
      remainingUsd: 0,
      error: PLATFORM_CREDITS_BUDGET_REQUIRED_MESSAGE,
    };
  }

  const remainingUsd = budget.totalCreditsUsd - budget.usedCreditsUsd;
  return {
    allowed: remainingUsd > BUDGET_THRESHOLD_USD,
    remainingUsd,
    ...(remainingUsd > BUDGET_THRESHOLD_USD ? {} : { error: formatBudgetBlockedMessage(remainingUsd) }),
  };
}

export function formatBudgetBlockedMessage(remainingUsd: number): string {
  return `Insufficient budget ($${remainingUsd.toFixed(2)} remaining)`;
}
