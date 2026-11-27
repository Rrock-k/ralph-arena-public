/**
 * Budget enforcement with TTL cache.
 *
 * RA-070: Costs are atomically incremented in ProjectBudget.usedCreditsUsd
 * on each API request (in recordUsage). No in-memory pending accumulator needed.
 */

const BUDGET_THRESHOLD = 0.10; // USD — reject if remaining <= this
const CACHE_TTL_MS = 30_000; // 30 seconds

interface CachedBudget {
  totalCreditsUsd: number;
  usedCreditsUsd: number;
  fetchedAt: number;
}

const cache = new Map<string, CachedBudget>();

export async function checkBudget(
  prisma: any,
  projectId: string,
  providerBillingMode?: string | null,
): Promise<{ allowed: boolean; remaining: number }> {
  if (providerBillingMode !== "platform_credits") {
    return { allowed: true, remaining: Infinity };
  }

  let cached = cache.get(projectId);
  if (!cached || Date.now() - cached.fetchedAt >= CACHE_TTL_MS) {
    const budget = await prisma.projectBudget.findUnique({
      where: { projectId },
      select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
    });

    if (!budget || !budget.isEnabled) {
      return { allowed: false, remaining: 0 };
    }

    cached = {
      totalCreditsUsd: budget.totalCreditsUsd,
      usedCreditsUsd: budget.usedCreditsUsd,
      fetchedAt: Date.now(),
    };
    cache.set(projectId, cached);
  }

  const remaining = cached.totalCreditsUsd - cached.usedCreditsUsd;

  return {
    allowed: remaining > BUDGET_THRESHOLD,
    remaining,
  };
}

/**
 * Invalidate cache for a project (called after cost is recorded).
 */
export function invalidateBudgetCache(projectId: string): void {
  cache.delete(projectId);
}
