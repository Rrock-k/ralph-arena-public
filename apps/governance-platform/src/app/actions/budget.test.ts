import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { adjustProjectBudget, adjustProjectBudgetInternal, setProjectBudgetLimit } from "./budget";
import { fakeProject } from "@/test/factories";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    accessGrant: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/budget-resume", () => ({
  tryAutoResumePausedRun: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/user-launch-policy", () => ({
  enforceUserLaunchPolicy: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@/lib/e2e-auth-bypass", () => ({
  hasE2EAdminBypass: vi.fn().mockResolvedValue(false),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { revalidatePath } from "next/cache";

const adminSession = {
  user: { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
  expires: new Date().toISOString(),
};

describe("budget actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(true);
  });

  it("blocks direct internal budget mutation without trusted server token", async () => {
    const result = await adjustProjectBudgetInternal("project-1", 5, "top up");

    expect(result).toEqual({
      success: false,
      error: "Internal action is not callable directly.",
    });
    expect((prisma as any).project.findUnique).not.toHaveBeenCalled();
  });

  it("rejects adjust when unauthenticated", async () => {
    vi.mocked(auth as any).mockResolvedValue(null);
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(false);

    const result = await adjustProjectBudget("project-1", 10);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("rejects debit without note", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);

    const result = await adjustProjectBudget("project-1", -5);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Note is required for budget debit");
  });

  it("adjusts budget with positive amount and records audit", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject() as any);

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        projectBudget: {
          findUnique: vi.fn().mockResolvedValue({
            totalCreditsUsd: 10,
            usedCreditsUsd: 2,
            isEnabled: true,
          }),
          upsert: vi.fn().mockResolvedValue({
            totalCreditsUsd: 15,
            usedCreditsUsd: 2,
          }),
        },
        projectBudgetAdjustment: {
          create: vi.fn().mockResolvedValue({ id: "adj-1" }),
        },
        project: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
        runLog: {
          create: vi.fn(),
        },
      };
      const result = await cb(tx);
      expect(tx.projectBudgetAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: "project-1",
          createdById: "admin-1",
          amountUsd: 5,
          kind: "TOP_UP",
        }),
      });
      return result;
    });

    const result = await adjustProjectBudget("project-1", 5, "top up");

    expect(result.success).toBe(true);
    expect(result.totalCreditsUsd).toBe(15);
    expect(result.usedCreditsUsd).toBe(2);
    expect(result.remainingUsd).toBe(13);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/projects/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("rejects adjust when resulting total drops below used", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject() as any);

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        projectBudget: {
          findUnique: vi.fn().mockResolvedValue({
            totalCreditsUsd: 10,
            usedCreditsUsd: 9,
            isEnabled: true,
          }),
          upsert: vi.fn(),
        },
        projectBudgetAdjustment: {
          create: vi.fn(),
        },
        project: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
        runLog: {
          create: vi.fn(),
        },
      };
      return cb(tx);
    });

    const result = await adjustProjectBudget("project-1", -2, "correction");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Budget cannot be lower than used amount");
  });

  it("sets budget limit and writes SET_LIMIT adjustment", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject() as any);

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        projectBudget: {
          findUnique: vi.fn().mockResolvedValue({
            totalCreditsUsd: 12,
            usedCreditsUsd: 3,
          }),
          upsert: vi.fn().mockResolvedValue({
            totalCreditsUsd: 20,
            usedCreditsUsd: 3,
          }),
        },
        projectBudgetAdjustment: {
          create: vi.fn().mockResolvedValue({ id: "adj-2" }),
        },
        project: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
        runLog: {
          create: vi.fn(),
        },
      };
      const result = await cb(tx);
      expect(tx.projectBudgetAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: "SET_LIMIT",
          amountUsd: 8,
        }),
      });
      return result;
    });

    const result = await setProjectBudgetLimit("project-1", 20, true, "raise cap");

    expect(result.success).toBe(true);
    expect(result.remainingUsd).toBe(17);
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });

  it("rejects set limit below used amount", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject() as any);

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        projectBudget: {
          findUnique: vi.fn().mockResolvedValue({
            totalCreditsUsd: 12,
            usedCreditsUsd: 7,
          }),
          upsert: vi.fn(),
        },
        projectBudgetAdjustment: {
          create: vi.fn(),
        },
        project: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
        runLog: {
          create: vi.fn(),
        },
      };
      return cb(tx);
    });

    const result = await setProjectBudgetLimit("project-1", 5, true, "mistake");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Budget limit cannot be lower than used amount");
  });

  it("auto-resumes project when paused by budget and credits are added", async () => {
    vi.mocked(auth as any).mockResolvedValue(adminSession as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject() as any);

    const { tryAutoResumePausedRun } = await import("@/lib/budget-resume");
    vi.mocked(tryAutoResumePausedRun).mockResolvedValueOnce("project-1");

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        projectBudget: {
          findUnique: vi.fn().mockResolvedValue({
            totalCreditsUsd: 1,
            usedCreditsUsd: 1,
            isEnabled: true,
          }),
          upsert: vi.fn().mockResolvedValue({
            totalCreditsUsd: 6,
            usedCreditsUsd: 1,
          }),
        },
        projectBudgetAdjustment: {
          create: vi.fn().mockResolvedValue({ id: "adj-3" }),
        },
        project: {
          findUnique: vi.fn().mockResolvedValue({ id: "project-1", status: "PAUSED" }),
          update: vi.fn().mockResolvedValue({}),
        },
        runLog: {
          create: vi.fn(),
        },
      };
      return cb(tx);
    });

    const result = await adjustProjectBudget("project-1", 5, "top up");

    expect(result.success).toBe(true);
    expect(result.resumedProjectId).toBe("project-1");
  });

  it("reserves user credits instead of freely topping up a Platform Credits project", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(false);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject({
      id: "project-credits",
      mode: "personal",
      ownerScopeType: "user",
      ownerScopeId: "user-1",
      providerBillingMode: "platform_credits",
    }) as any);

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        userCreditBalance: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ credits: 12 }),
        },
        userCreditAdjustment: {
          create: vi.fn().mockResolvedValue({ id: "user-adj-1" }),
        },
        projectBudget: {
          upsert: vi.fn().mockResolvedValue({
            totalCreditsUsd: 8,
            usedCreditsUsd: 1,
          }),
        },
        projectBudgetAdjustment: {
          create: vi.fn().mockResolvedValue({ id: "project-adj-1" }),
        },
      };
      const result = await cb(tx);
      expect(tx.userCreditBalance.updateMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          credits: { gte: 5 },
        },
        data: {
          credits: { decrement: 5 },
        },
      });
      expect(tx.projectBudgetAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: "project-credits",
          createdById: "user-1",
          amountUsd: 5,
          kind: "TOP_UP",
        }),
      });
      return result;
    });

    const result = await adjustProjectBudget("project-credits", 5, "user top-up");

    expect(result.success).toBe(true);
    expect(result.totalCreditsUsd).toBe(8);
    expect(result.usedCreditsUsd).toBe(1);
    expect(result.remainingUsd).toBe(7);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/projects/project-credits");
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-credits");
  });

  it("blocks non-finance direct debits on Platform Credits projects", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(false);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject({
      mode: "personal",
      ownerScopeType: "user",
      ownerScopeId: "user-1",
      providerBillingMode: "platform_credits",
    }) as any);

    const result = await adjustProjectBudget("project-1", -2, "manual debit");

    expect(result).toEqual({
      success: false,
      error: "Project credit debits require finance admin.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks non-finance set-limit inflation on Platform Credits projects", async () => {
    vi.mocked(auth as any).mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", role: "USER" },
      expires: new Date().toISOString(),
    });
    vi.mocked(hasE2EAdminBypass).mockResolvedValue(false);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject({
      mode: "personal",
      ownerScopeType: "user",
      ownerScopeId: "user-1",
      providerBillingMode: "platform_credits",
    }) as any);

    const result = await setProjectBudgetLimit("project-1", 200, true, "inflate");

    expect(result).toEqual({
      success: false,
      error: "Use Add Credits to fund Platform Credits projects.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps internal budget mutation helpers usable outside server-action revalidation context", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(fakeProject() as any);
    vi.mocked(revalidatePath).mockImplementation(() => {
      throw new Error("revalidatePath should not run in internal helper");
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = {
        projectBudget: {
          findUnique: vi.fn().mockResolvedValue({
            totalCreditsUsd: 12,
            usedCreditsUsd: 3,
            isEnabled: true,
          }),
          upsert: vi.fn().mockResolvedValue({
            totalCreditsUsd: 17,
            usedCreditsUsd: 3,
          }),
        },
        projectBudgetAdjustment: {
          create: vi.fn().mockResolvedValue({ id: "adj-internal" }),
        },
        project: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
        runLog: {
          create: vi.fn(),
        },
      };
      return cb(tx);
    });

    const result = await adjustProjectBudgetInternal("project-1", 5, "top up", {
      createdById: "admin-1",
      internalActionToken: INTERNAL_ACTION_TOKEN,
    });

    expect(result.success).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(notifyProjectChanged).toHaveBeenCalledWith("project-1");
  });
});
