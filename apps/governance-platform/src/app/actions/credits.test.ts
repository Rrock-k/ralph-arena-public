import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { grantCreditsInternal } from "./credits";

vi.mock("@/lib/feature-flags", () => ({
  isManagedProviderCreditsEnabled: vi.fn(),
}));

vi.mock("@/lib/errors", () => ({
  logError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    creditPurchase: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    userCreditBalance: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { isManagedProviderCreditsEnabled } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";

describe("grantCreditsInternal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isManagedProviderCreditsEnabled).mockResolvedValue(true);
    vi.mocked((prisma as any).creditPurchase.findUnique).mockResolvedValue(null);
    vi.mocked((prisma as any).user.findUnique).mockResolvedValue({ id: "user-1" });
    vi.mocked((prisma as any).userCreditBalance.findUnique).mockResolvedValue({ credits: 25 });
    vi.mocked((prisma as any).$transaction).mockImplementation(async (cb: any) => cb({
      creditPurchase: {
        create: vi.fn().mockResolvedValue({ id: "purchase-1" }),
      },
      userCreditBalance: {
        upsert: vi.fn().mockResolvedValue({ userId: "user-1", credits: 25 }),
      },
    }));
  });

  it("does not grant credits while Platform Credits are disabled", async () => {
    vi.mocked(isManagedProviderCreditsEnabled).mockResolvedValue(false);

    const result = await grantCreditsInternal("user-1", "45020", "license-1");

    expect(result).toEqual({
      success: false,
      error: "Platform Credits are disabled.",
    });
    expect((prisma as any).creditPurchase.findUnique).not.toHaveBeenCalled();
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it("grants credits when the feature flag is enabled", async () => {
    const result = await grantCreditsInternal("user-1", "45020", "license-1");

    expect(result).toEqual({
      success: true,
      credits: 25,
    });
    expect((prisma as any).creditPurchase.findUnique).toHaveBeenCalledWith({
      where: { freemiusLicenseId: "license-1" },
    });
    expect((prisma as any).$transaction).toHaveBeenCalledOnce();
  });
});
