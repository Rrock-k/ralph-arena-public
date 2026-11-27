import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkBudget,
  invalidateBudgetCache,
} from "../budget-check.js";

describe("budget-check", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("allows non-Platform Credits projects without checking budgets", async () => {
    const projectId = "project-byok";
    invalidateBudgetCache(projectId);

    const prisma = {
      projectBudget: {
        findUnique: vi.fn(),
      },
    };

    const result = await checkBudget(prisma, projectId, "byok");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Number.POSITIVE_INFINITY);
    expect(prisma.projectBudget.findUnique).not.toHaveBeenCalled();
  });

  it("allows Platform Credentials projects even when legacy budgets are exhausted", async () => {
    const projectId = "project-platform-credentials";
    invalidateBudgetCache(projectId);

    const prisma = {
      projectBudget: {
        findUnique: vi.fn().mockResolvedValue({
          isEnabled: true,
          totalCreditsUsd: 1,
          usedCreditsUsd: 1,
        }),
      },
    };

    const result = await checkBudget(prisma, projectId, "platform_credentials");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Number.POSITIVE_INFINITY);
    expect(prisma.projectBudget.findUnique).not.toHaveBeenCalled();
  });

  it("blocks Platform Credits projects when budget exists but limit is disabled", async () => {
    const projectId = "project-disabled";
    invalidateBudgetCache(projectId);

    const prisma = {
      projectBudget: {
        findUnique: vi.fn().mockResolvedValue({
          isEnabled: false,
          totalCreditsUsd: 1,
          usedCreditsUsd: 1,
        }),
      },
    };

    const result = await checkBudget(prisma, projectId, "platform_credits");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("blocks Platform Credits projects when budget is missing", async () => {
    const projectId = "project-platform-credits";
    invalidateBudgetCache(projectId);

    const prisma = {
      projectBudget: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const result = await checkBudget(prisma, projectId, "platform_credits");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("enforces Platform Credits from proxy registration even if DB project billing mode drifts", async () => {
    const projectId = "project-registry-platform-credits";
    invalidateBudgetCache(projectId);

    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          providerBillingMode: "byok",
        }),
      },
      projectBudget: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const result = await checkBudget(prisma, projectId, "platform_credits");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(prisma.projectBudget.findUnique).toHaveBeenCalledWith({
      where: { projectId },
      select: { isEnabled: true, totalCreditsUsd: true, usedCreditsUsd: true },
    });
  });

  it("blocks when remaining is below threshold", async () => {
    const projectId = "project-threshold";
    invalidateBudgetCache(projectId);

    const prisma = {
      projectBudget: {
        findUnique: vi.fn().mockResolvedValue({
          isEnabled: true,
          totalCreditsUsd: 10,
          usedCreditsUsd: 9.95,
        }),
      },
    };

    const result = await checkBudget(prisma, projectId, "platform_credits");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBeLessThanOrEqual(0.1);
  });

  it("uses cache for repeated checks and refreshes after invalidate", async () => {
    const projectId = "project-cache";
    invalidateBudgetCache(projectId);

    const prisma = {
      projectBudget: {
        findUnique: vi.fn().mockResolvedValue({
          isEnabled: true,
          totalCreditsUsd: 10,
          usedCreditsUsd: 1,
        }),
      },
    };

    const first = await checkBudget(prisma, projectId, "platform_credits");
    const second = await checkBudget(prisma, projectId, "platform_credits");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(prisma.projectBudget.findUnique).toHaveBeenCalledTimes(1);

    invalidateBudgetCache(projectId);
    await checkBudget(prisma, projectId, "platform_credits");
    expect(prisma.projectBudget.findUnique).toHaveBeenCalledTimes(2);
  });
});
