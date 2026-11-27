import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_THRESHOLD_USD,
  enforceProjectBudget,
  enforceRequiredProjectBudget,
  formatBudgetBlockedMessage,
} from "./project-budget";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectBudget: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

describe("project-budget helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when budget is not configured", async () => {
    vi.mocked((prisma as any).projectBudget.findUnique).mockResolvedValue(null);

    const result = await enforceProjectBudget("project-1");

    expect(result.allowed).toBe(true);
    expect(result.remainingUsd).toBe(Number.POSITIVE_INFINITY);
  });

  it("allows when budget limit is disabled", async () => {
    vi.mocked((prisma as any).projectBudget.findUnique).mockResolvedValue({
      isEnabled: false,
      totalCreditsUsd: 10,
      usedCreditsUsd: 9,
    });

    const result = await enforceProjectBudget("project-1");

    expect(result.allowed).toBe(true);
    expect(result.remainingUsd).toBe(Number.POSITIVE_INFINITY);
  });

  it("blocks when remaining budget is at threshold", async () => {
    vi.mocked((prisma as any).projectBudget.findUnique).mockResolvedValue({
      isEnabled: true,
      totalCreditsUsd: 1,
      usedCreditsUsd: 1 - BUDGET_THRESHOLD_USD,
    });

    const result = await enforceProjectBudget("project-1");

    expect(result.allowed).toBe(false);
    expect(result.remainingUsd).toBeCloseTo(BUDGET_THRESHOLD_USD);
  });

  it("allows when remaining budget is above threshold", async () => {
    vi.mocked((prisma as any).projectBudget.findUnique).mockResolvedValue({
      isEnabled: true,
      totalCreditsUsd: 5,
      usedCreditsUsd: 4,
    });

    const result = await enforceProjectBudget("project-1");

    expect(result.allowed).toBe(true);
    expect(result.remainingUsd).toBe(1);
  });

  it("blocks required budget when budget is missing", async () => {
    vi.mocked((prisma as any).projectBudget.findUnique).mockResolvedValue(null);

    const result = await enforceRequiredProjectBudget("project-1");

    expect(result.allowed).toBe(false);
    expect(result.error).toBe("Platform Credits project requires a funded budget.");
  });

  it("formats blocked message", () => {
    expect(formatBudgetBlockedMessage(0.034)).toBe("Insufficient budget ($0.03 remaining)");
  });
});
