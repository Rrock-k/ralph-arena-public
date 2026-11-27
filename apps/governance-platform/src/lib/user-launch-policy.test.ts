import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasUserProviderCredential = vi.fn();
const isByokProviderKeysEnabled = vi.fn();
const isManagedProviderCreditsEnabled = vi.fn();
const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));

function readSrc(relativePath: string): string {
  return readFileSync(`${SRC_ROOT}/${relativePath}`, "utf8");
}

vi.mock("@/lib/user-provider-credentials", () => ({
  hasUserProviderCredential,
  providerDisplayName: (provider: string) =>
    provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "OpenCode",
  providerForAgent: (agent: string) => {
    if (agent === "codex") return "openai";
    if (agent === "claude-code") return "anthropic";
    if (agent === "opencode") return "opencode";
    return null;
  },
}));

vi.mock("@/lib/feature-flags", () => ({
  isByokProviderKeysEnabled,
  isManagedProviderCreditsEnabled,
}));

describe("user launch policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasUserProviderCredential.mockResolvedValue(true);
    isByokProviderKeysEnabled.mockResolvedValue(true);
    isManagedProviderCreditsEnabled.mockResolvedValue(false);
  });

  it("blocks managed VPS launches for non-privileged users", async () => {
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "codex",
      runnerBackend: "vps",
    })).resolves.toEqual({
      allowed: false,
      error: "Managed VPS launches are not available for user projects yet.",
    });
  });

  it("allows controlled Antigravity launches for local Ralph platform credentials", async () => {
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: true,
      agent: "antigravity",
      agentImpl: "ralph",
      runnerBackend: "local",
      providerBillingMode: "platform_credentials",
    })).resolves.toEqual({ allowed: true });
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("blocks Antigravity launches outside the controlled operator contract", async () => {
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "antigravity",
      agentImpl: "ralph",
      runnerBackend: "local",
      providerBillingMode: "platform_credentials",
    })).resolves.toEqual({
      allowed: false,
      error: "Antigravity CLI uses platform-owned product auth and is only available for platform-operator launches until disposable project smoke is verified.",
    });
    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: true,
      agent: "antigravity",
      agentImpl: "ralph",
      runnerBackend: "local",
      providerBillingMode: "byok",
    })).resolves.toEqual({
      allowed: false,
      error: "Antigravity CLI uses authd-owned product keyring auth; select platform_credentials for controlled operator launches.",
    });
    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: true,
      agent: "antigravity",
      agentImpl: "direct",
      runnerBackend: "local",
      providerBillingMode: "platform_credentials",
    })).resolves.toEqual({
      allowed: false,
      error: "Antigravity CLI is currently supported only through the local Ralph runtime, where the authd keyring volume is mounted into the worker container.",
    });
    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: true,
      agent: "antigravity",
      agentImpl: "ralph",
      runnerBackend: "vps",
      providerBillingMode: "platform_credentials",
    })).resolves.toEqual({
      allowed: false,
      error: "Antigravity CLI is currently supported only through the local Ralph runtime, where the authd keyring volume is mounted into the worker container.",
    });
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("requires the matching provider key for non-privileged agent launches", async () => {
    hasUserProviderCredential.mockResolvedValue(false);
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "claude-code",
      runnerBackend: "local",
    })).resolves.toEqual({
      allowed: false,
      error: "Anthropic API key is required in Settings before launch.",
    });
  });

  it("blocks provider launches when BYOK provider keys are disabled", async () => {
    isByokProviderKeysEnabled.mockResolvedValue(false);
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "codex",
      runnerBackend: "local",
    })).resolves.toEqual({
      allowed: false,
      error: "User provider API-key launches are disabled.",
    });
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("allows provider launches through Platform Credits when feature flag is enabled", async () => {
    isManagedProviderCreditsEnabled.mockResolvedValue(true);
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "codex",
      runnerBackend: "local",
      providerBillingMode: "platform_credits",
    })).resolves.toEqual({ allowed: true });
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("blocks OpenCode Platform Credits because api-proxy does not own OpenCode debit", async () => {
    isManagedProviderCreditsEnabled.mockResolvedValue(true);
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "opencode",
      runnerBackend: "local",
      providerBillingMode: "platform_credits",
    })).resolves.toEqual({
      allowed: false,
      error: "Platform Credits are not available for OpenCode launches because OpenCode Zen is not routed through api-proxy. Use OpenCode free models outside Platform Credits.",
    });
    expect(isManagedProviderCreditsEnabled).not.toHaveBeenCalled();
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("blocks Platform Credits provider launches when feature flag is disabled", async () => {
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "codex",
      runnerBackend: "local",
      providerBillingMode: "platform_credits",
    })).resolves.toEqual({
      allowed: false,
      error: "Platform Credits provider runs are disabled.",
    });
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("blocks platform credentials for non-privileged users", async () => {
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "codex",
      runnerBackend: "local",
      providerBillingMode: "platform_credentials",
    })).resolves.toEqual({
      allowed: false,
      error: "Platform provider credentials are only available to platform operators.",
    });
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("allows platform-managed launch options for privileged users", async () => {
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: true,
      agent: "codex",
      runnerBackend: "vps",
      providerBillingMode: "platform_credentials",
    })).resolves.toEqual({ allowed: true });
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("still requires the matching BYOK provider key for privileged user-owned launches", async () => {
    hasUserProviderCredential.mockResolvedValue(false);
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: true,
      agent: "codex",
      runnerBackend: "vps",
      providerBillingMode: "byok",
    })).resolves.toEqual({
      allowed: false,
      error: "OpenAI API key is required in Settings before launch.",
    });
    expect(isByokProviderKeysEnabled).not.toHaveBeenCalled();
  });

  it("allows OpenCode Zen free launches without BYOK keys", async () => {
    hasUserProviderCredential.mockResolvedValue(false);
    const { enforceUserLaunchPolicy } = await import("./user-launch-policy");

    await expect(enforceUserLaunchPolicy({
      userId: "user-1",
      privileged: false,
      agent: "opencode",
      runnerBackend: "local",
      providerBillingMode: "byok",
    })).resolves.toEqual({ allowed: true });
    expect(hasUserProviderCredential).not.toHaveBeenCalled();
  });

  it("normalizes provider auth modes from billing ownership", async () => {
    const { normalizeAuthModesForProviderBilling } = await import("./user-launch-policy");

    expect(normalizeAuthModesForProviderBilling("codex", "platform_credits", {
      codexAuthMode: "api_key",
    })).toEqual({
      claudeAuthMode: null,
      codexAuthMode: null,
    });
    expect(normalizeAuthModesForProviderBilling("codex", "byok", {
      codexAuthMode: "subscription",
    })).toEqual({
      claudeAuthMode: null,
      codexAuthMode: "api_key",
    });
    expect(normalizeAuthModesForProviderBilling("codex", "platform_credentials", {
      codexAuthMode: "subscription",
    })).toEqual({
      claudeAuthMode: null,
      codexAuthMode: "subscription",
    });
    expect(normalizeAuthModesForProviderBilling("opencode", "byok", {
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    })).toEqual({
      claudeAuthMode: null,
      codexAuthMode: null,
    });
  });

  it("strictly parses provider billing modes without defaulting unsupported values", async () => {
    const { parseProviderBillingMode } = await import("./user-launch-policy");

    expect(parseProviderBillingMode("byok")).toBe("byok");
    expect(parseProviderBillingMode("platform_credits")).toBe("platform_credits");
    expect(parseProviderBillingMode("platform_credentials")).toBe("platform_credentials");
    expect(parseProviderBillingMode("platform-creditz")).toBeNull();
    expect(parseProviderBillingMode(null)).toBeNull();
  });

  it("keeps user project pages from opting into platform launch controls", () => {
    const myPage = readSrc("app/(main)/my/page.tsx");
    expect(myPage).not.toContain("resolvePlatformAccess");
    expect(myPage).not.toMatch(/allowPlatformCredentials\s*=/);
    expect(myPage).not.toMatch(/allowManagedVps\s*=/);

    const myProjectPage = readSrc("app/(main)/my/projects/[id]/page.tsx");
    expect(myProjectPage).toContain("resolvePlatformAccess");
    expect(myProjectPage).toContain("const allowPlatformCredentials =");
    expect(myProjectPage).toContain("allowPlatformCredentials,");
    expect(myProjectPage).toContain("allowManagedVps,");
    expect(myProjectPage).not.toMatch(/allowPlatformCredentials=\{true\}/);
    expect(myProjectPage).not.toMatch(/allowManagedVps=\{true\}/);
  });

  it("keeps Ops project creation tied to platform project management capability", () => {
    const contents = readSrc("components/admin/ops/OpsDashboard.tsx");

    expect(contents).toContain("allowPlatformCredentials={canManagePlatformProjects}");
    expect(contents).toContain("allowManagedVps={canManagePlatformProjects}");
    expect(contents).not.toMatch(/\sallowPlatformCredentials\s*\n/);
    expect(contents).not.toMatch(/\sallowManagedVps\s*\n/);
  });

  it("keeps managed VPS badges out of normal project card surfaces", () => {
    const previewCard = readSrc("components/ui/project-card/PreviewCard.tsx");
    const homePage = readSrc("app/(main)/page.tsx");
    const explorePage = readSrc("app/(main)/explore/page.tsx");
    const myPage = readSrc("app/(main)/my/page.tsx");
    const projectsGrid = readSrc("components/admin/ProjectsGrid.tsx");
    const projectsTable = readSrc("components/admin/ProjectsTable.tsx");

    expect(previewCard).toContain('showBackendBadge && project.runnerBackend === "vps"');
    expect(homePage).not.toContain("showBackendBadge");
    expect(explorePage).not.toContain("showBackendBadge");
    expect(myPage).not.toContain("showBackendBadge");
    expect(projectsGrid).toContain("showBackendBadge={canManagePlatformProjects || canManagePlatformRuntime}");
    expect(projectsTable).toContain("canManagePlatformProjects || canManagePlatformRuntime");
  });
});
