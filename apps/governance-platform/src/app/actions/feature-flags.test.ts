import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFeatureFlag } from "./feature-flags";
import { FEATURE_FLAG_KEYS } from "@/lib/feature-flag-keys";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    featureFlag: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/platform-access", () => ({
  requirePlatformCapability: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requirePlatformCapability } from "@/lib/platform-access";
import { revalidatePath } from "next/cache";

const adminAccess = {
  authorized: true,
  session: {
    user: { id: "admin-1", role: "ADMIN" },
    expires: new Date().toISOString(),
  },
};

describe("feature-flags actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlatformCapability).mockResolvedValue(adminAccess as any);
  });

  it("rejects unauthenticated user", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Unauthorized",
    } as any);

    const result = await setFeatureFlag(FEATURE_FLAG_KEYS.budgetVisibility, true);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unauthorized");
  });

  it("rejects non-admin user", async () => {
    vi.mocked(requirePlatformCapability).mockResolvedValue({
      authorized: false,
      error: "Platform access denied",
    } as any);

    const result = await setFeatureFlag(FEATURE_FLAG_KEYS.budgetVisibility, true);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Platform access denied");
  });

  it("updates known flag and revalidates admin page", async () => {
    vi.mocked((prisma as any).featureFlag.upsert).mockResolvedValue({
      key: FEATURE_FLAG_KEYS.budgetVisibility,
      enabled: true,
    });

    const result = await setFeatureFlag(FEATURE_FLAG_KEYS.budgetVisibility, true);

    expect(result).toEqual({
      success: true,
      key: FEATURE_FLAG_KEYS.budgetVisibility,
      enabled: true,
    });
    expect((prisma as any).featureFlag.upsert).toHaveBeenCalledWith({
      where: { key: FEATURE_FLAG_KEYS.budgetVisibility },
      create: {
        key: FEATURE_FLAG_KEYS.budgetVisibility,
        enabled: true,
        updatedById: "admin-1",
      },
      update: {
        enabled: true,
        updatedById: "admin-1",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("rejects unknown flag key", async () => {
    const result = await setFeatureFlag("unknown_flag" as any, true);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown feature flag");
    expect((prisma as any).featureFlag.upsert).not.toHaveBeenCalled();
  });
});
