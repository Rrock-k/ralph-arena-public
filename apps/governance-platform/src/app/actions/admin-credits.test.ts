import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    creditPurchase: {
      findMany: vi.fn(),
    },
    userCreditAdjustment: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { requirePlatformCapability } from "@/lib/platform-access";
import { prisma } from "@/lib/prisma";
import { adminGrantUserCredits } from "./admin-credits";

describe("adminGrantUserCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: true,
      session: { user: { id: "admin-1" } },
    } as any);
    vi.mocked((prisma as any).user.findUnique).mockResolvedValue({ id: "user-1" });
    vi.mocked((prisma as any).$transaction).mockImplementation(async (cb: any) => cb({
      userCreditAdjustment: {
        create: vi.fn(),
      },
      userCreditBalance: {
        upsert: vi.fn().mockResolvedValue({ credits: 42 }),
      },
    }));
  });

  it("requires platform finance access", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Platform access denied",
    } as any);

    await expect(adminGrantUserCredits({
      userId: "user-1",
      amountUsd: 10,
      note: "support credit",
    })).resolves.toEqual({
      success: false,
      error: "Platform access denied",
    });
  });

  it("writes an admin credit grant with the actor id", async () => {
    const result = await adminGrantUserCredits({
      userId: "user-1",
      amountUsd: 10.129,
      note: "Support credit",
    });

    expect(result).toEqual({ success: true, credits: 42 });
    const transaction = vi.mocked((prisma as any).$transaction).mock.calls[0]?.[0];
    const txCreate = vi.fn();
    const txUpsert = vi.fn().mockResolvedValue({ credits: 42 });
    await transaction({
      userCreditAdjustment: { create: txCreate },
      userCreditBalance: { upsert: txUpsert },
    });

    expect(txCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        createdById: "admin-1",
        amountUsd: 10.13,
        kind: "ADMIN_CREDIT_GRANT",
        note: "Support credit",
      },
    });
    expect(txUpsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", credits: 10.13 },
      update: { credits: { increment: 10.13 } },
      select: { credits: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
    expect(revalidatePath).toHaveBeenCalledWith("/credits");
  });

  it("requires an audit note", async () => {
    await expect(adminGrantUserCredits({
      userId: "user-1",
      amountUsd: 10,
      note: " ",
    })).resolves.toEqual({
      success: false,
      error: "A note is required for admin credit grants.",
    });
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});
