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
import { FEATURE_FLAG_KEYS } from "./feature-flag-keys";
import { filterCapabilitiesByFlags } from "./capability-flags";

function mockFlags(overrides: Partial<Record<string, boolean>> = {}) {
  const defaults: Record<string, boolean> = {
    [FEATURE_FLAG_KEYS.budgetVisibility]: false,
    [FEATURE_FLAG_KEYS.communityQa]: false,
    [FEATURE_FLAG_KEYS.notifications]: false,
    ...overrides,
  };
  vi.mocked((prisma as any).featureFlag.findMany).mockResolvedValue(
    Object.entries(defaults).map(([key, enabled]) => ({ key, enabled })),
  );
}

describe("filterCapabilitiesByFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips community_qa when feature flag is OFF", async () => {
    mockFlags({ [FEATURE_FLAG_KEYS.communityQa]: false });

    const result = await filterCapabilitiesByFlags(["specs", "progress", "community_qa", "log_streaming"]);

    expect(result).toEqual(["specs", "progress", "log_streaming"]);
  });

  it("keeps community_qa when feature flag is ON", async () => {
    mockFlags({ [FEATURE_FLAG_KEYS.communityQa]: true });

    const result = await filterCapabilitiesByFlags(["specs", "progress", "community_qa"]);

    expect(result).toEqual(["specs", "progress", "community_qa"]);
  });

  it("passes through capabilities without flag mapping unchanged", async () => {
    mockFlags();

    const result = await filterCapabilitiesByFlags(["specs", "progress", "log_streaming"]);

    expect(result).toEqual(["specs", "progress", "log_streaming"]);
  });

  it("skips DB query when no gated capabilities present", async () => {
    const result = await filterCapabilitiesByFlags(["specs", "progress"]);

    expect(result).toEqual(["specs", "progress"]);
    expect((prisma as any).featureFlag.findMany).not.toHaveBeenCalled();
  });

  it("handles empty capabilities array", async () => {
    const result = await filterCapabilitiesByFlags([]);

    expect(result).toEqual([]);
    expect((prisma as any).featureFlag.findMany).not.toHaveBeenCalled();
  });
});
