import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  removeUserProviderCredential,
  saveUserProviderCredential,
} from "./provider-credentials";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  isByokProviderKeysEnabled: vi.fn(),
}));

vi.mock("@/lib/user-provider-credentials", () => ({
  deleteUserProviderCredential: vi.fn(),
  isUserProviderId: (value: string) => value === "openai" || value === "anthropic" || value === "opencode",
  providerDisplayName: (provider: string) =>
    provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "OpenCode",
  upsertUserProviderCredential: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { isByokProviderKeysEnabled } from "@/lib/feature-flags";
import {
  deleteUserProviderCredential,
  upsertUserProviderCredential,
} from "@/lib/user-provider-credentials";
import { revalidatePath } from "next/cache";

describe("provider credential actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(isByokProviderKeysEnabled).mockResolvedValue(true);
    vi.mocked(upsertUserProviderCredential).mockResolvedValue({ success: true });
    vi.mocked(deleteUserProviderCredential).mockResolvedValue({ success: true });
  });

  it("blocks saving provider keys when BYOK feature flag is disabled", async () => {
    vi.mocked(isByokProviderKeysEnabled).mockResolvedValue(false);

    const result = await saveUserProviderCredential("openai", "sk-test");

    expect(result).toEqual({
      success: false,
      error: "User provider API keys are disabled.",
    });
    expect(upsertUserProviderCredential).not.toHaveBeenCalled();
  });

  it("blocks removing provider keys when BYOK feature flag is disabled", async () => {
    vi.mocked(isByokProviderKeysEnabled).mockResolvedValue(false);

    const result = await removeUserProviderCredential("anthropic");

    expect(result).toEqual({
      success: false,
      error: "User provider API keys are disabled.",
    });
    expect(deleteUserProviderCredential).not.toHaveBeenCalled();
  });

  it("saves provider keys when feature flag is enabled", async () => {
    const result = await saveUserProviderCredential("openai", "sk-test");

    expect(result).toEqual({ success: true, message: "OpenAI key saved" });
    expect(upsertUserProviderCredential).toHaveBeenCalledWith("user-1", "openai", "sk-test");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });
});
