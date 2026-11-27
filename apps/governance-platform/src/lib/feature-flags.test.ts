import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    featureFlag: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { FEATURE_FLAG_KEYS } from "@/lib/feature-flag-keys";
import {
  __private__,
  getFeatureFlagsSnapshot,
  isBudgetVisibilityEnabled,
  isByokProviderKeysEnabled,
  isManagedProviderCreditsEnabled,
} from "./feature-flags";

describe("feature flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to disabled when DB row is missing", async () => {
    vi.mocked((prisma as any).featureFlag.findUnique).mockResolvedValue(null);

    const enabled = await isBudgetVisibilityEnabled();

    expect(enabled).toBe(false);
    expect((prisma as any).featureFlag.findUnique).toHaveBeenCalledWith({
      where: { key: FEATURE_FLAG_KEYS.budgetVisibility },
      select: { enabled: true },
    });
  });

  it("reads budget visibility flag from DB", async () => {
    vi.mocked((prisma as any).featureFlag.findUnique).mockResolvedValue({ enabled: true });

    await expect(isBudgetVisibilityEnabled()).resolves.toBe(true);
  });

  it("returns feature flag snapshot with defaults", async () => {
    vi.mocked((prisma as any).featureFlag.findMany).mockResolvedValue([
      { key: FEATURE_FLAG_KEYS.budgetVisibility, enabled: true },
    ]);

    await expect(getFeatureFlagsSnapshot()).resolves.toEqual({
      budgetVisibility: true,
      communityQa: false,
      notifications: false,
      byokProviderKeys: true,
      managedProviderCredits: false,
    });
  });

  it("defaults BYOK provider keys to enabled", async () => {
    vi.mocked((prisma as any).featureFlag.findUnique).mockResolvedValue(null);

    await expect(isByokProviderKeysEnabled()).resolves.toBe(true);
  });

  it("defaults managed provider credits to disabled", async () => {
    vi.mocked((prisma as any).featureFlag.findUnique).mockResolvedValue(null);

    await expect(isManagedProviderCreditsEnabled()).resolves.toBe(false);
  });

  it("allows direct lookup helper", async () => {
    vi.mocked((prisma as any).featureFlag.findUnique).mockResolvedValue({ enabled: false });
    await expect(__private__.getFeatureFlagEnabled(FEATURE_FLAG_KEYS.budgetVisibility)).resolves.toBe(false);
  });
});
